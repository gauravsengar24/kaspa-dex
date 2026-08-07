/**
 * KCC-20 token DEPLOY engine — the pump.fun-equivalent for Kaspa L1 covenants.
 *
 * Launching a KCC-20 token is two covenant transactions, both non-custodial (the user's
 * KIP-12 wallet signs only its own P2PK funding inputs):
 *
 *   1. CREATE — births the bonding-curve covenant `C`. The tx creates one covenant output
 *      (the curve redeem script at genesis state { graduated:false, tokenCovid:ZERO,
 *      tokenReserve:0 }) funded by `seedKas`, plus the enforced launch-fee output
 *      (P2PK → platform treasury) and change. `curveCovid` is derived with
 *      `genesisCovenantId` from the FIRST funding input + the curve output
 *      (KRON `buildCpGenesis`): the curve's address MOVES per state.
 *
 *   2. INIT   — spends `C` with the curve entrypoint `init` (selector 0) and pre-mints the
 *      ENTIRE supply once into two KCC-20 covenant outputs:
 *        output[1] = inventory (covenant-owned by curve covid → binds curve ⇄ token),
 *        output[2] = dev allocation (ADDRESS presence-owned by the creator's pubkey).
 *      `tokenCovid` is derived with `genesisCovenantId` (genesis outpoint = the curve UTXO
 *      + the two new outputs). The curve's `init` requires the inventory id to have ZERO
 *      covenant inputs (OpCovInputCount == 0), so supply is fixed forever — mint authority
 *      is renounced at birth (the curve continuation keeps carrying C's native value).
 *
 * Templates are compiled IN-BROWSER from the vendored covenant sources under
 * `public/kron-silverc` via the silverc WASM compiler — byte-exact with the schema the
 * KRON indexer expects (identical sources + identical arg layout), so a token deployed by
 * this engine lists identically to one deployed by the KRON app. The deploys compiled here
 * are a port of the KRON deployed client bundle's `compileCpTemplates` (i), `buildCpGenesis`
 * (DL), `buildCpInit` (BL) and `initSig` (ML) — verified byte-for-byte against the sources
 * vendored in this repo.
 *
 * Transaction assembly reuses the shared `assembleAndSize` + `signAndSubmit` path from
 * `./kcc20.ts` (SDK `assembleNativeTx` → `estimateNativeFee` → `toPsktJson` → wallet
 * `signPskt` → node submit), so only the FUNDING inputs are ever wallet-signed.
 */
import { blake2b } from "@noble/hashes/blake2b"
import type { Kaspa } from "@kronsdk/kron-sdk/wasm"
import * as kron from "@kronsdk/kron-sdk"
import {
  getKaspa,
  getRpc,
  hexToBytes,
  bytesToHex,
  assembleAndSize,
  signAndSubmit,
  type WalletBridge,
} from "./kcc20"
import {
  fetchLaunchFee,
  type FeePolicy,
} from "./kron"

/* ---------------------------------------------------------------------------
 * constants — mirrored from the KRON deployed client bundle
 * ------------------------------------------------------------------------- */

/** SCALE — one bonding-curve step: 1e6 sompi = 0.01 KAS (`ps`/`ab` in the bundle). */
export const SCALE = 1_000_000n
/** Sompi per 1 KAS (`ob`). */
export const SOMPI_PER_KAS = 100_000_000n
/** Default seed KAS funding the curve at birth (`Xt` = 0.5 KAS). */
export const DEFAULT_SEED_KAS = 50_000_000n
/** KIP-9 covenant-output dust (`Xc`/COVENANT_DUST = 0.5 KAS). */
export const COVENANT_DUST = 50_000_000n
/** Fixed supply cap (`RL`). */
export const MAX_SUPPLY = 1_000_000_000n
/** Minimum clamped supply (`Km`). */
export const SUPPLY_MIN = 1_000_000n
/** Curve max raise (`nb` = 9,000,000 KAS in sompi). */
export const MAX_CURVE_KAS = 9_000_000_000_000_000n

export const FEE_CREATOR_BPS = 25
export const FEE_PLATFORM_BPS = 90
export const FEE_DEV_FUND_BPS = 10
export const FEE_GRADUATION_BPS = 500
export const DEX_CREATOR_BPS = 10
export const DEX_PLATFORM_BPS = 70
export const DEX_LP_BPS = 20

/** The KRON treasury x-only pubkey (mainnet) — launch fees + pool fee owners. */
export const PLATFORM_OWNER_HEX =
  "060035d0c92d123a8f3d73029ac313d989c8e01b287c90ff38ebdbb92b0066de"
/** Launch-fee sanity cap (`Cd`). */
export const LAUNCH_FEE_CAP = 500_000_000_000n
/** Network id this deploy targets. */
export const NETWORK_ID = "mainnet"

const GRAD_MIN = 10
const GRAD_MAX = 9_000_000
const GRAD_DEFAULT = 250_000
/** `Rd` — clamp a graduation target (KAS). */
function clampGradTkas(n: number): number {
  return Math.max(GRAD_MIN, Math.min(GRAD_MAX, Math.floor(n || 0)))
}
const PCT_DEFAULT = 80
const POOL_LOCKED_DEFAULT = 1_000_000
/** `CE` — clamp locked shares into [1, 1_000_000]. */
function clampLockedShares(n?: number): number {
  if (!n || !Number.isFinite(n)) return POOL_LOCKED_DEFAULT
  return Math.max(1, Math.min(1_000_000, Math.floor(n)))
}
/** `kE` (splitToVKas) — the virtual reserve that anchors the curve price at the chosen
 *  seller split: gradKas(sompi)/SCALE · (100−pct)/pct, floored at 1 SCALE unit. */
function splitToVKas(gradSompi: bigint, pctSold: number): bigint {
  const e = gradSompi / SCALE
  const pct = Math.max(1, Math.round(pctSold || PCT_DEFAULT))
  const s = (e * BigInt(100 - pct)) / BigInt(pct)
  return s < 1n ? 1n : s
}

/* ---------------------------------------------------------------------------
 * vendored in-browser covenant compiler (public/kron-silverc)
 * ------------------------------------------------------------------------- */

export interface CovenantSources {
  kcc20: string
  curveCp: string
  poolCp: string
  buyOrder: string
}

export interface CompilerCore {
  compile: (src: string, argsJson: string) => { scriptHex: string; stateStart: number; stateLen: number }
  sources: CovenantSources
  currentSchema: string
}

let _silverc: Promise<CompilerCore> | null = null

/** Silverc runtime sources: served locally during dev (`public/kron-silverc`) and, on
 *  platforms that reject binary files (HuggingFace Spaces), from the jsDelivr mirror of
 *  the GitHub-tagged runtime bundle. */
const SILVERC_LOCAL = "/kron-silverc"
const SILVERC_CDN = "https://cdn.jsdelivr.net/gh/gauravsengar24/kaspa-dex@silverc-runtime/public/kron-silverc"

async function silvercMod(rel: string): Promise<any> {
  try {
    return await import(/* @vite-ignore */ `${SILVERC_LOCAL}/${rel}`)
  } catch {
    return await import(/* @vite-ignore */ `${SILVERC_CDN}/${rel}`)
  }
}

function silvercWasmPath(): string {
  return `${SILVERC_CDN}/silverc_wasm.wasm`
}

/** blake2b-256 (the covenant template hash). */
function b2(data: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32 })
}

function rconcat(...arr: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arr.reduce((s, a) => s + a.length, 0))
  let o = 0
  for (const a of arr) { out.set(a, o); o += a.length }
  return out
}

/**
 * Lazily load the vendored silverc WASM glue + the five covenant `.sil` sources, then init
 * the compiler with the wasm module. Port of the KRON app's `VE` (loadCore): the compiled
 * output is normalized (Map-or-plain-object) and `currentSchema` is derived from the
 * sources so a deploy can be pinned to the exact schema the server expects.
 */
export function loadSilverc(): Promise<CompilerCore> {
  _silverc ??= (async () => {
    const glue = await silvercMod(`silverc_wasm-BTSjJr4e.js`)
    const bg = await silvercMod(`silverc_wasm_bg-fdbtgxnf.js`)
    const kcc20 = await silvercMod(`kcc20-Dfi_6-9r.js`)
    const curveCp = await silvercMod(`curve_cp-D7Vj80I3.js`)
    const poolCp = await silvercMod(`amm_pool_cp_v3-liI7d5lT.js`)
    const buyOrder = await silvercMod(`buy_order-BdZc6mtW.js`)
    if (typeof glue.default !== "function") {
      throw new Error("silverc glue module is missing its init export (corrupt build?)")
    }
    await glue.default({ module_or_path: bg.default ?? silvercWasmPath() })
    const compile = (src: string, argsJson: string) => {
      const r = glue.compile(src, argsJson)
      const get = (key: string) => (r instanceof Map ? r.get(key) : r?.[key])
      return {
        scriptHex: String(get("scriptHex") ?? ""),
        stateStart: Number(get("stateStart") ?? 0),
        stateLen: Number(get("stateLen") ?? 0),
      }
    }
    const sources: CovenantSources = {
      kcc20: String(kcc20.default ?? ""),
      curveCp: String(curveCp.default ?? ""),
      poolCp: String(poolCp.default ?? ""),
      buyOrder: String(buyOrder.default ?? ""),
    }
    return { compile, sources, currentSchema: schemaHashOfSources(sources) }
  })()
  _silverc.catch(() => { _silverc = null })
  return _silverc
}

/** `UE` — blake2b-256 over the four (len-prefixed) covenant sources, in registry order. */
export function schemaHashOfSources(sources: CovenantSources): string {
  const parts: Uint8Array[] = []
  const names = ["kcc20", "curveCp", "poolCp", "buyOrder"] as const
  for (const key of names) {
    const src = String(sources[key] ?? "")
    if (!src.length) throw new Error(`schemaHashOfSources: missing source '${key}'`)
    const bytes = new TextEncoder().encode(src)
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, bytes.length, true)
    parts.push(len, bytes)
  }
  return bytesToHex(b2(rconcat(...parts)))
}

/* ---------------------------------------------------------------------------
 * silverc typed-arg encoders (port of the bundle's Lt/Gf/Kt/bo/…)
 * ------------------------------------------------------------------------- */

type SylArg =
  | { kind: "int"; data: number }
  | { kind: "byte"; data: number }
  | { kind: "bool"; data: boolean }
  | { kind: "array"; data: { kind: "byte"; data: number }[] }

const sylInt = (n: bigint | number): SylArg => ({ kind: "int", data: Number(n) })
const sylByte = (n: number): SylArg => ({ kind: "byte", data: n })
const sylBool = (v = false): SylArg => ({ kind: "bool", data: !!v })
const sylBytes = (n: Uint8Array): SylArg => ({ kind: "array", data: [...n].map((b) => ({ kind: "byte", data: b })) })

/** `s`/prefixSuffix — split a compiled script at its state region. */
function prefixSuffix(r: { scriptHex: string; stateStart: number; stateLen: number }) {
  const script = hexToBytes(r.scriptHex)
  return {
    script,
    prefix: script.slice(0, r.stateStart),
    suffix: script.slice(r.stateStart + r.stateLen),
  }
}

/* ---------------------------------------------------------------------------
 * compileLaunchTemplates — port of the bundle's `i` + `sL`
 * ------------------------------------------------------------------------- */

/** Curve template compiled by this engine (SDK CpTemplate + the init witness flag). */
export interface CpTemplate {
  script: Uint8Array
  stateStart: number
  /** whether the compiled curve requires an `initializerWitness` in the init sig. */
  initializerWitnessRequired: boolean
  params: {
    creatorFeeOwner: Uint8Array
    platformFeeOwner: Uint8Array
    vKas: bigint
    graduationKas: bigint
    creatorFeeBps: bigint
    platformFeeBps: bigint
    graduationFeeBps: bigint
    devFundBps?: bigint
    devFundOwner?: Uint8Array
  }
}

/** The compiled deploy template-set for one launch (fresh ZERO covid). Serializes to the
 *  same bytes the KRON app compiles for the same deploy params. */
export interface CompiledLaunchTemplates {
  curve: CpTemplate
  token: kron.kcc20.Kcc20Template
  pool: kron.poolCp.PoolCpTemplate
  order?: { script: Uint8Array; stateStart: number; stateLen: number }
  /** the curve schema hash the indexer expects (fetchLaunchFee → templateSchema). */
  currentSchema: string
}

/** The curve params as compiled (EE output shape → registry `curveParams`). */
export interface CpParamsRecord {
  creatorFeeOwner: string
  platformFeeOwner: string
  devFundOwner?: string
  vKas: number
  graduationKas: number
  creatorFeeBps: number
  platformFeeBps: number
  graduationFeeBps: number
  devFundBps?: number
  dexCreatorFeeBps: number
  dexPlatformFeeBps: number
  dexLpFeeBps: number
  poolLockedShares: number
}

/** `EE` — the baked curve params for a deploy. */
export function buildCpParams(p: {
  creatorFeeOwner: string
  platformFeeOwner?: string
  devFundOwner?: string
  gradTkas?: number
  pctSold?: number
  poolLockedShares?: number
}): CpParamsRecord {
  const gradSompi = BigInt(clampGradTkas(p.gradTkas ?? GRAD_DEFAULT)) * SOMPI_PER_KAS
  const platform = (p.platformFeeOwner ?? p.creatorFeeOwner).toLowerCase()
  return {
    creatorFeeOwner: p.creatorFeeOwner.toLowerCase(),
    platformFeeOwner: platform,
    devFundOwner: (p.devFundOwner ?? platform).toLowerCase(),
    vKas: Number(splitToVKas(gradSompi, p.pctSold ?? PCT_DEFAULT)),
    graduationKas: Number(gradSompi),
    creatorFeeBps: FEE_CREATOR_BPS,
    platformFeeBps: FEE_PLATFORM_BPS,
    graduationFeeBps: FEE_GRADUATION_BPS,
    devFundBps: FEE_DEV_FUND_BPS,
    dexCreatorFeeBps: DEX_CREATOR_BPS,
    dexPlatformFeeBps: DEX_PLATFORM_BPS,
    dexLpFeeBps: DEX_LP_BPS,
    poolLockedShares: clampLockedShares(p.poolLockedShares),
  }
}

/**
 * Port of KRON `i` (compileCpTemplates) — compiles kcc20, buy_order, amm_pool_cp_v3 and
 * curve_cp in the exact arg layout of the deployed client, then shapes them (sL) into the
 * templates the SDK builders consume. `tokenCovidHex` ZERO = a fresh, never-initialized
 * curve (deploy path).
 */
export async function compileLaunchTemplates(p: {
  creatorFeeOwner: string
  platformFeeOwner?: string
  devFundOwner?: string
  vKas?: number
  graduationKas?: number
  creatorFeeBps?: number
  platformFeeBps?: number
  graduationFeeBps?: number
  devFundBps?: number
  dexCreatorFeeBps?: number
  dexPlatformFeeBps?: number
  dexLpFeeBps?: number
  poolLockedShares?: number
  tokenCovidHex?: string
  maxIns?: number
  maxOuts?: number
}): Promise<CompiledLaunchTemplates> {
  const { compile, sources, currentSchema } = await loadSilverc()

  const hasOrder = sources.curveCp.includes("orderPrefix")      // f
  const hasDevFund = sources.curveCp.includes("devFundOwner")   // g

  const maxIns = p.maxIns ?? 4
  const maxOuts = p.maxOuts ?? (hasOrder ? 5 : 4)
  const ZERO = new Uint8Array(32)
  const tokenCov = hexToBytes(p.tokenCovidHex ?? "00".repeat(32))
  const creatorOwner = hexToBytes(p.creatorFeeOwner)
  const platformOwner = hexToBytes(p.platformFeeOwner ?? PLATFORM_OWNER_HEX)
  const devFundOwnerBytes = hasDevFund
    ? hexToBytes(p.devFundOwner ?? PLATFORM_OWNER_HEX)
    : new Uint8Array(0)
  const devBps = Number(p.devFundBps ?? FEE_DEV_FUND_BPS)
  if (creatorOwner.length !== 32) throw new Error("creatorFeeOwner must be a 32-byte pubkey (64-hex)")
  if (platformOwner.length !== 32) throw new Error("platformFeeOwner must be a 32-byte pubkey (64-hex)")
  if (hasDevFund && devFundOwnerBytes.length !== 32) {
    throw new Error("devFundOwner must be a 32-byte pubkey (64-hex) for this curve schema")
  }

  const vKas = BigInt(p.vKas ?? 1)
  const graduationKas = BigInt(Math.floor(p.graduationKas ?? GRAD_DEFAULT * Number(SOMPI_PER_KAS)))
  const creatorFeeBps = p.creatorFeeBps ?? FEE_CREATOR_BPS
  const platformFeeBps = p.platformFeeBps ?? FEE_PLATFORM_BPS
  const graduationFeeBps = p.graduationFeeBps ?? FEE_GRADUATION_BPS
  const dexCreatorFeeBps = p.dexCreatorFeeBps ?? DEX_CREATOR_BPS
  const dexPlatformFeeBps = p.dexPlatformFeeBps ?? DEX_PLATFORM_BPS
  const dexLpFeeBps = p.dexLpFeeBps ?? DEX_LP_BPS
  const locked = clampLockedShares(p.poolLockedShares)

  // ---- kcc20 token covenant: (maxIns, maxOuts, ZERO owner, COVENANT_ID, 0, false) ----
  const tok = compile(sources.kcc20, JSON.stringify([
    sylInt(maxIns), sylInt(maxOuts), sylBytes(ZERO), sylByte(2), sylInt(0), sylBool(false),
  ]))
  const tokPS = prefixSuffix(tok)
  const tokHash = b2(rconcat(tokPS.prefix, tokPS.suffix))

  // ---- buy_order (only when the curve schema has orderPrefix) ----
  let order: { script: Uint8Array; prefix: Uint8Array; suffix: Uint8Array; hash: Uint8Array } | null = null
  if (hasOrder && sources.buyOrder) {
    const o = compile(sources.buyOrder, JSON.stringify([
      sylBytes(tokPS.prefix), sylBytes(tokPS.suffix), sylBytes(tokHash),
      sylBytes(ZERO), sylBytes(ZERO), sylInt(0), sylInt(0),
    ]))
    const oo = prefixSuffix(o)
    order = {
      script: oo.script,
      prefix: oo.prefix,
      suffix: oo.suffix,
      hash: b2(rconcat(oo.prefix, oo.suffix)),
    }
  }

  // ---- amm_pool_cp_v3 (the graduation target; ZERO init reserves + covid) ----
  const poolArgs: SylArg[] = [
    sylInt(0), sylInt(0), sylInt(0), sylInt(locked),          // initKas/initToken/initShares/lockedShares
    sylBytes(tokenCov), sylBytes(tokPS.prefix), sylBytes(tokPS.suffix), sylBytes(tokHash),
    sylInt(tokPS.prefix.length), sylInt(tokPS.suffix.length), // tokPrefixLen/tokSuffixLen
    sylBytes(ZERO),                                           // initLpCovid
    sylBytes(platformOwner), sylBytes(platformOwner),         // pool creator/platform fee owners
    sylInt(dexCreatorFeeBps), sylInt(dexPlatformFeeBps), sylInt(dexLpFeeBps),
  ]
  const pool = compile(sources.poolCp, JSON.stringify(poolArgs))
  const poolPS = prefixSuffix(pool)
  const poolHash = b2(rconcat(poolPS.prefix, poolPS.suffix))

  // ---- curve_cp (vesting retired → the none-branch arg list) ----
  const curveArgs: SylArg[] = [
    sylBytes(creatorOwner),
    sylBytes(platformOwner),
    sylBytes(creatorOwner),                              // creatorIdentifier (owner of dev seat)
    sylInt(vKas), sylInt(graduationKas),
    sylInt(creatorFeeBps), sylInt(platformFeeBps), sylInt(graduationFeeBps),
    sylBytes(tokenCov),                                  // initTokenCovid (ZERO at genesis)
    sylBytes(tokPS.prefix), sylBytes(tokPS.suffix), sylBytes(tokHash),
    sylInt(tokPS.prefix.length), sylInt(tokPS.suffix.length),
    sylBytes(poolPS.prefix), sylBytes(poolPS.suffix), sylBytes(poolHash),
    sylBool(false),                                      // initGraduated
    sylInt(locked), sylInt(0),                           // poolLockedShares, initTokenReserve
  ]
  if (order) curveArgs.push(sylBytes(order.hash), sylInt(order.prefix.length), sylInt(order.suffix.length))
  if (hasDevFund) curveArgs.push(sylBytes(devFundOwnerBytes), sylInt(devBps))

  const curve = compile(sources.curveCp, JSON.stringify(curveArgs))
  const curvePS = prefixSuffix(curve)
  const initializerWitnessRequired = sources.curveCp.includes("entrypoint function init(int initializerWitness")

  return {
    curve: {
      script: curvePS.script,
      stateStart: curve.stateStart,
      initializerWitnessRequired,
      params: {
        creatorFeeOwner: creatorOwner,
        platformFeeOwner: platformOwner,
        vKas,
        graduationKas,
        creatorFeeBps: BigInt(creatorFeeBps),
        platformFeeBps: BigInt(platformFeeBps),
        graduationFeeBps: BigInt(graduationFeeBps),
        ...(hasDevFund ? { devFundOwner: devFundOwnerBytes, devFundBps: BigInt(devBps) } : {}),
      },
    },
    token: { script: tokPS.script, stateStart: tok.stateStart, maxIns, maxOuts },
    pool: {
      script: poolPS.script,
      stateStart: pool.stateStart,
      canonicalInventoryRequired: sources.poolCp.includes("poolLpOut.amount == newInventory"),
    },
    ...(order ? { order: { script: order.script, stateStart: 0, stateLen: 0 } } : {}),
    currentSchema,
  }
}

/* ---------------------------------------------------------------------------
 * builders — the two covenant txs a launch makes (create + init)
 * ------------------------------------------------------------------------- */

export interface GenesisCurve {
  curveCovid: string
  curveAddress: string
  curveOutput: { value: bigint; scriptPublicKey: any; binding: kron.spend.CovBinding }
  redeem: Uint8Array
}

const genesisState = () => ({
  graduated: false,
  tokenCovid: new Uint8Array(32),
  tokenReserve: 0n,
})

/**
 * buildCpGenesis (port of DL) — the CREATE tx's curve: materialize the genesis state
 * redeem, then `genesisCovenantId` off the FIRST funding input gives `curveCovid` and the
 * curve's address client-side, before anything is broadcast.
 */
export function buildCpGenesis(
  k: Kaspa,
  curveTpl: CpTemplate,
  genesisOutpoint: { transactionId: string; index: number },
  value: bigint,
  network = NETWORK_ID,
): GenesisCurve {
  const redeem = kron.curveCp.materializeCpScript(curveTpl, genesisState())
  const spk = kron.curveCp.cpSpk(k, redeem)
  const curveCovid = kron.genesis.genesisCovenantId(k, genesisOutpoint, [
    { index: 0, value, scriptPublicKey: spk },
  ])
  const curveAddress = kron.curveCp.cpAddress(k, curveTpl, genesisState(), network)
  return {
    curveCovid,
    curveAddress,
    curveOutput: {
      value,
      scriptPublicKey: spk,
      binding: { covid: curveCovid, authorizingInput: 0 },
    },
    redeem,
  }
}

/** The signed script a curve `init` needs: witness(int), inventory state, dev state,
 *  selector(init), redeem. Port of KRON `ML`/initSig. */
export function initSig(
  k: Kaspa,
  curveTpl: CpTemplate,
  curveRedeem: Uint8Array,
  inventory: kron.kcc20.Kcc20State,
  dev: kron.kcc20.Kcc20State,
): string {
  const b = new kron.sigscript.SigScriptBuilder(k)
  if (curveTpl.initializerWitnessRequired) b.int(1n)
  kron.kcc20.pushKcc20StateScalar(b, inventory)
  kron.kcc20.pushKcc20StateScalar(b, dev)
  return b.selector(0).redeem(curveRedeem).drain()
}

/**
 * buildCpInit (port of BL) — the INIT tx. Builds the token-A genesis covenant id
 * (genesis outpoint = the curve outpoint being spent + the two fresh token outputs), then
 * the covenant spend:
 *   inputs  [0] curve (genesis state, realKas native value)
 *   outputs [0] curve continuation (binds tokenCovid, keeps the real KAS),
 *           [1] inventory token (covenant-owned by curve covid),
 *           [2] dev token (ADDRESS-presence owned by the creator pubkey).
 * All three outputs bind to `authorizingInput: 0` (the curve input) per KIP-20.
 */
export function buildCpInit(
  k: Kaspa,
  curveTpl: CpTemplate,
  tokenTpl: kron.kcc20.Kcc20Template,
  utxo: {
    transactionId: string
    index: number
    realKas: bigint
    state: { graduated: boolean; tokenCovid: Uint8Array; tokenReserve: bigint }
  },
  curveCovidBytes: Uint8Array,
  inventoryAmount: bigint,
  devAmount: bigint,
  opts?: { tokenDust?: bigint },
): kron.spend.CovenantSpend {
  if (inventoryAmount < 1n) throw new Error("inventory must be >= 1")
  if (devAmount < 1n) throw new Error('dev allocation must be >= 1 (curve_cp requires a dev output; use 1 for "no dev")')
  if (inventoryAmount + devAmount > MAX_SUPPLY) {
    throw new Error("inventory + dev allocation exceeds the fixed 1,000,000,000 token cap")
  }

  const dust = opts?.tokenDust ?? kron.spend.COVENANT_DUST
  const inventoryState = kron.kcc20.covenantIdOwned(curveCovidBytes, inventoryAmount)
  const devState = kron.kcc20.addressPresenceOwned(curveTpl.params.creatorFeeOwner, devAmount)

  const invRedeem = kron.kcc20.materializeKcc20Script(tokenTpl, inventoryState)
  const devRedeem = kron.kcc20.materializeKcc20Script(tokenTpl, devState)
  const invSpk = kron.kcc20.kcc20Spk(k, invRedeem)
  const devSpk = kron.kcc20.kcc20Spk(k, devRedeem)

  const tokenCovid = kron.genesis.genesisCovenantId(
    k,
    { transactionId: utxo.transactionId, index: utxo.index },
    [
      { index: 1, value: dust, scriptPublicKey: invSpk },
      { index: 2, value: dust, scriptPublicKey: devSpk },
    ],
  )
  const tokenCovidBytes = hexToBytes(tokenCovid)

  const curveOutState = {
    graduated: utxo.state.graduated,
    tokenCovid: tokenCovidBytes,
    tokenReserve: inventoryAmount,
  }
  const curveRedeem = kron.curveCp.materializeCpScript(curveTpl, utxo.state)
  const curveInputSpk = kron.curveCp.cpSpk(k, curveRedeem)
  const curveContSpk = kron.curveCp.cpSpk(k, kron.curveCp.materializeCpScript(curveTpl, curveOutState))

  const signatureScript = initSig(k, curveTpl, curveRedeem, inventoryState, devState)

  const curveCovid = bytesToHex(curveCovidBytes)
  return {
    kind: "init",
    inputs: [{
      transactionId: utxo.transactionId,
      index: utxo.index,
      value: utxo.realKas,
      scriptPublicKey: curveInputSpk,
      signatureScript,
      redeem: curveRedeem,
      role: "curve",
    }],
    outputs: [
      {
        value: utxo.realKas,
        scriptPublicKey: curveContSpk,
        role: "curve",
        binding: { covid: curveCovid, authorizingInput: 0 },
      },
      { value: dust, scriptPublicKey: invSpk, role: "inventory", binding: { covid: tokenCovid, authorizingInput: 0 } },
      { value: dust, scriptPublicKey: devSpk, role: "devAlloc", binding: { covid: tokenCovid, authorizingInput: 0 } },
    ],
    economics: { inventoryAmount, devAmount },
    covids: { tokenCovid, curveCovid },
  }
}
/* ---------------------------------------------------------------------------
 * deployLaunch — the full on-chain create + init sequence (port of KRON `OA`)
 * ------------------------------------------------------------------------- */

const LAUNCH_PARTNER_REF = "kaspadex"
const LAUNCH_FEE_RATE = 100
const TX_VERSION = 1
const SUBNET_ZERO = "0000000000000000000000000000000000000000"
const FUNDING_COMPUTE = 10

export interface DeployLaunchParams {
  /** the creator's 32-byte x-only pubkey hex (fee + dev seat owner). */
  creatorFeeOwner: string
  /** total fixed supply (whole tokens; clamped to [SUPPLY_MIN, MAX_SUPPLY]). */
  supply: bigint
  /** tokens allocated to the dev seat; >= 1 (curve_cp requires the output). */
  devAmount?: bigint
  /** graduation target in KAS (clamped to [10, 9,000,000]). */
  gradTkas?: number
  /** seller split % at graduation (`pctSold`; default 80). */
  pctSold?: number
  poolLockedShares?: number
  /** seed KAS funding the curve at birth (default 0.5 KAS, a SCALE multiple). */
  seedKas?: bigint
  /** the P2PK change address for funding-input leftovers. */
  changeAddress: string
}

export interface DeployLaunchResult {
  /** the CREATE tx (curve genesis). */
  createTxId: string
  /** the INIT tx (pre-mint + bind) — this is the token's genesis tx. */
  initTxId: string
  genesisTxid: string
  curveCovid: string
  curveAddress: string
  tokenCovid: string
  /** the cooked curve + dex params (matches KRON's registry `curveParams`). */
  params: CpParamsRecord
  initialInventory: number
  devAmount: number
  realKas: number
  tokenReserve: number
}

export interface DeployLaunchCallbacks {
  onProgress?: (msg: string) => void
}

/** Greedy cap-target funding selection (KRON `selectFunds`): largest first, sum >= target. */
export function selectFunds(
  entries: kron.spend.FundingEntry[],
  target: bigint,
): { picked: kron.spend.FundingEntry[]; sum: bigint } {
  const picked: kron.spend.FundingEntry[] = []
  let sum = 0n
  for (const e of [...entries].sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1))) {
    picked.push(e)
    sum += BigInt(e.amount)
    if (sum >= target) break
  }
  if (sum < target) throw new Error(`insufficient funds: need ${target} sompi, have ${sum}`)
  return { picked, sum }
}

/** The CREATE tx: coinbase-preservation curve output (binding = its own covid) + launch fee + change. */
function buildCreate(
  k: Kaspa,
  funding: kron.spend.FundingEntry[],
  curveOut: { value: bigint; scriptPublicKey: any; covid: string },
  feeOut: { value: bigint; scriptPublicKey: any } | null,
  changeAddress: string,
  networkFee: bigint,
): { transaction: any; fundingInputIndexes: number[]; totalIn: bigint; covenantOut: bigint; change: bigint } {
  const inputs = funding.map(
    (e) =>
      new k.TransactionInput({
        previousOutpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index },
        signatureScript: "",
        sequence: 0n,
        sigOpCount: 0,
        computeBudget: FUNDING_COMPUTE,
        utxo: e,
      }),
  )
  const outputs = [
    new k.TransactionOutput(curveOut.value, curveOut.scriptPublicKey, new k.CovenantBinding(0, new k.Hash(curveOut.covid))),
    ...(feeOut ? [new k.TransactionOutput(feeOut.value, feeOut.scriptPublicKey)] : []),
  ]
  const totalIn = funding.reduce((s, e) => s + BigInt(e.amount), 0n)
  const covenantOut = curveOut.value + (feeOut?.value ?? 0n)
  const change = totalIn - covenantOut - networkFee
  if (change < 0n) {
    throw new Error(`insufficient funding for the create tx: need ${covenantOut + networkFee} sompi, have ${totalIn}`)
  }
  outputs.push(new k.TransactionOutput(change, k.payToAddressScript(changeAddress)))
  const transaction = new k.Transaction({
    version: TX_VERSION,
    inputs,
    outputs,
    lockTime: 0n,
    gas: 0n,
    payload: "",
    subnetworkId: SUBNET_ZERO,
  })
  return { transaction, fundingInputIndexes: inputs.map((_, i) => i), totalIn, covenantOut, change }
}

/** Assemble CREATE with a guess fee, size it, re-assemble with the real fee, return the pskt shape. */
async function assembleCreate(
  k: Kaspa,
  funding: kron.spend.FundingEntry[],
  curveOut: { value: bigint; scriptPublicKey: any; covid: string },
  feeOut: { value: bigint; scriptPublicKey: any } | null,
  changeAddress: string,
): Promise<{ txJsonString: string; signInputs: { index: number; sighashType: number }[] }> {
  const guess = buildCreate(k, funding, curveOut, feeOut, changeAddress, 10_000n)
  const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, guess, LAUNCH_FEE_RATE)
  const final = buildCreate(k, funding, curveOut, feeOut, changeAddress, networkFee)
  return kron.spend.toPsktJson(final)
}

/** Poll the node until the CREATE's curve outpoint (index 0) is spendable. */
async function waitForCurveUtxo(address: string, txid: string, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const rpc = await getRpc()
  for (;;) {
    try {
      const res = await rpc.getUtxosByAddresses({ addresses: [address] })
      const hit = res.entries?.find((e: any) => e.outpoint.transactionId === txid && e.outpoint.index === 0)
      if (hit) return true
    } catch {
      /* retry */
    }
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 4_000))
  }
}

const sameHex = (a?: string, b?: string) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase()

/** Normalize a wallet UTXO report into SDK funding entries (≥ covenant dust). */
function parseFunding(raw: { outpoint: { transactionId: string; index: number }; entry?: { amount?: string }; amount?: any }[]): kron.spend.FundingEntry[] {
  return raw
    .map((f) => ({
      outpoint: { transactionId: f.outpoint.transactionId, index: f.outpoint.index },
      amount: BigInt(f.entry?.amount ?? f.amount ?? "0"),
    }))
    .filter((e) => e.amount >= kron.spend.COVENANT_DUST)
}

/**
 * The complete on-chain launch: CREATE (curve genesis + enforced launch fee), wait, then
 * INIT (pre-mint the full supply into inventory + dev, binding token A to the curve).
 * Only the wallet's own P2PK funding inputs are signed (assemble → PSKT → sign → submit).
 * Registry listing is separate — make `recordToken`/`signMessageWithKasware` with this result.
 */
export async function deployLaunch(
  bridge: WalletBridge,
  p: DeployLaunchParams,
  cb?: DeployLaunchCallbacks,
  opts?: { launchFeeSompi?: bigint; templateSchema?: string; skipPolicyCheck?: boolean },
): Promise<DeployLaunchResult> {
  const onProgress = cb?.onProgress ?? (() => {})

  const pubKey = String(p.creatorFeeOwner).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pubKey)) throw new Error("creatorFeeOwner must be a 32-byte pubkey (64-hex)")
  const address = await bridge.getAddress()
  if (!address) throw new Error("connect a wallet first")
  const raw0 = await bridge.getUtxoEntries?.(address)
  if (!raw0?.length) throw new Error(`no UTXOs at ${address}. Connect your FUNDED wallet and retry.`)

  const supply = BigInt(Math.max(Number(SUPPLY_MIN), Math.min(Number(MAX_SUPPLY), Number(p.supply))))
  const devAmount = BigInt(p.devAmount ?? 1n)
  if (devAmount < 1n) throw new Error("dev allocation must be >= 1")
  if (devAmount >= supply) throw new Error("dev allocation must be < total supply")
  const inventory = supply - devAmount
  const seedKas = p.seedKas ?? DEFAULT_SEED_KAS
  if (seedKas <= 0n || seedKas % SCALE !== 0n) throw new Error("seedKas must be a positive multiple of SCALE (0.01 KAS)")

  // ---- launch fee + enforced fee policy (mirror KRON's server-side sanity checks) ----
  let launchFee = opts?.launchFeeSompi ?? 0n
  let feePolicy: FeePolicy | undefined
  let serverSchema: string | undefined
  onProgress("Checking the launch fee…")
  const quote = await fetchLaunchFee()
  if (quote) {
    const q = quote.sompi ? BigInt(quote.sompi) : 0n
    if (q > launchFee) launchFee = q
    feePolicy = quote.feePolicy
    serverSchema = quote.templateSchema
  }
  if (!quote && launchFee === 0n) {
    throw new Error("could not fetch the launch-fee quote from the backend. Retry in a minute (deploying without it would get the token delisted).")
  }
  if (launchFee < 0n || launchFee > LAUNCH_FEE_CAP) {
    throw new Error(`launch fee ${launchFee} sompi exceeds KRON's safety cap (${LAUNCH_FEE_CAP} sompi)`)
  }

  const platform = (feePolicy?.platformFeeOwner ?? PLATFORM_OWNER_HEX).toLowerCase()
  const devFundOwner = feePolicy?.devFundOwner ? feePolicy.devFundOwner.toLowerCase() : platform
  const params = buildCpParams({
    creatorFeeOwner: pubKey,
    platformFeeOwner: platform,
    devFundOwner,
    gradTkas: p.gradTkas,
    pctSold: p.pctSold,
    poolLockedShares: p.poolLockedShares,
  })

  if (feePolicy?.enforced && !opts?.skipPolicyCheck) {
    const diffs: string[] = []
    if (!sameHex(params.platformFeeOwner, feePolicy.platformFeeOwner)) diffs.push("platform treasury key")
    if (!sameHex(params.devFundOwner, feePolicy.devFundOwner)) diffs.push("dev-fund key")
    for (const f of ["creatorFeeBps", "platformFeeBps", "devFundBps", "graduationFeeBps", "dexCreatorFeeBps", "dexPlatformFeeBps", "dexLpFeeBps"] as const) {
      if (feePolicy[f] != null && params[f] !== feePolicy[f]) diffs.push(`${f} (this build ${params[f]} vs server ${feePolicy[f]})`)
    }
    if (diffs.length) {
      throw new Error(`this build's fee configuration does not match the KRON backend (${diffs.join(", ")}). Launching now would be delisted. Report this: the site build and server env are out of sync.`)
    }
  }

  onProgress("Compiling the covenant templates…")
  const k = await getKaspa()
  const tpls = await compileLaunchTemplates({
    creatorFeeOwner: params.creatorFeeOwner,
    platformFeeOwner: params.platformFeeOwner,
    devFundOwner: params.devFundOwner,
    vKas: params.vKas,
    graduationKas: params.graduationKas,
    creatorFeeBps: params.creatorFeeBps,
    platformFeeBps: params.platformFeeBps,
    graduationFeeBps: params.graduationFeeBps,
    devFundBps: params.devFundBps,
    dexCreatorFeeBps: params.dexCreatorFeeBps,
    dexPlatformFeeBps: params.dexPlatformFeeBps,
    dexLpFeeBps: params.dexLpFeeBps,
    poolLockedShares: params.poolLockedShares,
  })
  const schema = (opts?.templateSchema ?? serverSchema ?? tpls.currentSchema).toLowerCase()
  if (tpls.currentSchema.toLowerCase() !== schema) {
    throw new Error(`this page compiles a different covenant schema than the backend records (bundle ${tpls.currentSchema.slice(0, 12)}… vs server ${schema.slice(0, 12)}…). Reload before launching.`)
  }

  // ---- CREATE: select funding (first picked = genesis outpoint), build, sign, submit ----
  const funding0 = parseFunding(raw0)
  if (!funding0.length) throw new Error("no spendable P2PK UTXOs in wallet")
  const { picked: createFunds } = selectFunds(funding0, seedKas + launchFee + kron.spend.COVENANT_DUST + 20_000_000n)
  const first = createFunds[0]
  const genesis = buildCpGenesis(k, tpls.curve, { transactionId: first.outpoint.transactionId, index: first.outpoint.index }, seedKas)

  const feeSpk = launchFee > 0n ? kron.curveCp.p2pkSpk(k, hexToBytes(params.platformFeeOwner)) : null
  onProgress(`Sign the create tx in your wallet… (curve ${genesis.curveCovid.slice(0, 12)}…, launch fee ${launchFee > 0n ? `${Number(launchFee) / 1e8} KAS` : "free"})`)
  const createPskt = await assembleCreate(
    k,
    createFunds,
    { value: genesis.curveOutput.value, scriptPublicKey: genesis.curveOutput.scriptPublicKey, covid: genesis.curveCovid },
    feeSpk ? { value: launchFee, scriptPublicKey: feeSpk } : null,
    p.changeAddress,
  )
  const createTxId = await signAndSubmit(bridge, createPskt)
  onProgress(`Create tx ${createTxId.slice(0, 14)}… submitted. Waiting for the curve UTXO…`)
  if (!(await waitForCurveUtxo(genesis.curveAddress, createTxId))) {
    throw new Error(`create tx ${createTxId} not confirmed in time. Press Deploy again to resume; the curve will exist at ${genesis.curveAddress}`)
  }

  // ---- INIT: pre-mint supply into inventory + dev, bind token A to the curve ----
  const curveUtxo = {
    transactionId: createTxId,
    index: 0,
    realKas: seedKas,
    state: { graduated: false, tokenCovid: new Uint8Array(32), tokenReserve: 0n },
  }
  onProgress("Building the init transaction (pre-mint supply + bind A)…")
  const spend = buildCpInit(k, tpls.curve, tpls.token, curveUtxo, hexToBytes(genesis.curveCovid), inventory, devAmount, { tokenDust: kron.spend.COVENANT_DUST })
  const tokenA = spend.covids?.tokenCovid ?? ""
  const curveId = genesis.curveCovid
  const tokenDust = spend.outputs[1].value + spend.outputs[2].value

  const raw2 = await bridge.getUtxoEntries?.(address)
  const funding2 = parseFunding(raw2 ?? [])
  if (!funding2.length) throw new Error("no spendable P2PK UTXOs for the init tx")
  const { picked: initFunds } = selectFunds(funding2, tokenDust + kron.spend.COVENANT_DUST + 20_000_000n)
  const { pskt: initPskt } = await assembleAndSize(spend, initFunds, p.changeAddress)
  onProgress(`Sign the init tx in your wallet… (token A = ${tokenA.slice(0, 12)}…)`)
  const initTxId = await signAndSubmit(bridge, initPskt)
  onProgress(`Deployed. ${Number(supply).toLocaleString()} supply pre-minted on-chain.`)

  return {
    createTxId,
    initTxId,
    genesisTxid: initTxId,
    curveCovid: curveId,
    curveAddress: genesis.curveAddress,
    tokenCovid: tokenA,
    params,
    initialInventory: Number(inventory),
    devAmount: Number(devAmount),
    realKas: Number(seedKas),
    tokenReserve: Number(inventory),
  }
}