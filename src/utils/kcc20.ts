import * as kron from "@kronsdk/kron-sdk"
import { loadKaspa, type Kaspa } from "@kronsdk/kron-sdk/wasm"
import type { TokenInfo } from "../types"

type RpcClient = InstanceType<Kaspa["RpcClient"]>

/**
 * KCC-20 / KRON covenant integration (@kronsdk/kron-sdk).
 *
 * Standard: KCC-20 fungible tokens on Kaspa L1 covenants — bonding curve `curve_cp`
 * that graduates into an AMM pool `amm_pool_cp_v3`. Non-custodial: every write is a
 * transaction the USER'S wallet signs via the KIP-12 `signPskt` bridge; this module
 * only assembles.
 *
 * Two layers (mirrors KronSDK/kron-sdk · docs/BUILDING-TRADES.md):
 *   - Templates (cached per token)   → KRON backend compile (cp-template).
 *   - Live state (fresh every trade)  → indexer / sequencer / node. The covenant
 *     address MOVES on every trade (state is spliced into the script), so UTXOs and
 *     the covenant head are re-read per trade.
 *
 * Mainnet only (TN10 retired).
 */

const INDEXER_URL = "https://idx.kron.technology/v1/kcc20"
const REGISTRY_URL = "https://api.kron.technology"
const SEQUENCER_URL = "https://seq.kron.technology"
const TEMPLATE_URL = "https://api.kron.technology/api/native/cp-template"
const NODE_WRPC = "wss://node.kron.technology"
const NETWORK_ID = "mainnet"
const SOMPI_PER_KAS = 100_000_000
const FEE_RATE = 100
const PARTNER_REF = "kaspadex"
const DEFAULT_DECIMALS = 8

let _kaspaPromise: Promise<Kaspa> | null = null
export function getKaspa(): Promise<Kaspa> {
  _kaspaPromise ??= loadKaspa()
  return _kaspaPromise
}

let _rpc: RpcClient | null = null
export async function getRpc(): Promise<RpcClient> {
  if (_rpc) return _rpc
  const k = await getKaspa()
  _rpc = new k.RpcClient({ url: NODE_WRPC, networkId: NETWORK_ID, encoding: k.Encoding.Borsh })
  await _rpc.connect()
  return _rpc
}

export function indexer() {
  return new kron.client.IndexerClient(INDEXER_URL)
}
export function registry() {
  return new kron.client.RegistryClient(REGISTRY_URL)
}
function sequencer() {
  return new kron.client.SequencerClient(SEQUENCER_URL)
}

/* ---------------------------------------------------------------------------
 * Templates (compiled once per token, cached)
 * ------------------------------------------------------------------------- */

export interface CompiledTemplates {
  token: kron.kcc20.Kcc20Template
  pool: kron.poolCp.PoolCpTemplate
  curve: kron.curveCp.CpTemplate
  params: kron.poolCp.PoolCpParams
}

const _templateCache = new Map<string, CompiledTemplates>()

/** Convert a server blob ({script, stateStart, params}) into SDK template shapes. */
function compileFromBody(body: any): any {
  const b = (s: any) => (typeof s === "string" ? hexToBytes(s) : new Uint8Array(s ?? []))
  const p = body?.pool?.params
  return {
    token: { script: b(body?.token?.script), stateStart: Number(body?.token?.stateStart ?? 0) },
    pool: {
      script: b(body?.pool?.script),
      stateStart: Number(body?.pool?.stateStart ?? 0),
      canonicalInventoryRequired: body?.pool?.canonicalLpInventory ?? true,
    },
    curve: { script: b(body?.curve?.script), stateStart: Number(body?.curve?.stateStart ?? 0) },
    params: p
      ? {
          creatorFeeOwner: b(p.creatorFeeOwner),
          platformFeeOwner: b(p.platformFeeOwner),
          creatorFeeBps: BigInt(p.creatorFeeBps ?? 0),
          platformFeeBps: BigInt(p.platformFeeBps ?? 0),
          lpFeeBps: BigInt(p.lpFeeBps ?? 0),
          lockedShares: BigInt(p.lockedShares ?? 0),
        }
      : emptyPoolParams(),
  }
}

function emptyPoolParams(): kron.poolCp.PoolCpParams {
  return {
    creatorFeeOwner: new Uint8Array(32),
    platformFeeOwner: new Uint8Array(32),
    creatorFeeBps: 0n,
    platformFeeBps: 0n,
    lpFeeBps: 0n,
    lockedShares: 0n,
  }
}

/**
 * Fetch (and cache) the compiled covenant templates for exactly the version this token
 * was deployed under (registry `curveParams` verbatim + tokenCovid + version pin).
 */
export async function getTemplates(tick: string): Promise<CompiledTemplates> {
  const key = tick.toLowerCase()
  const cached = _templateCache.get(key)
  if (cached) return cached

  const reg = registry()
  const list = await reg.tokenlist()
  const entry = list.tokens.find((t) => t.symbol.toLowerCase() === key)
  if (!entry) throw new Error(`Token ${tick} not found in KRON registry`)

  const res = await fetch(TEMPLATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(entry.extensions.curveParams ?? {}),
      tokenCovid: entry.covenantId,
      templateVersion: entry.extensions.templateVersion,
    }),
  })
  if (!res.ok) throw new Error(`cp-template compile failed (HTTP ${res.status})`)
  const body = await res.json()
  const compiled = compileFromBody(body)
  if (!compiled.token?.script?.length) throw new Error(`cp-template returned no token script for ${tick}`)
  const templates = compiled as CompiledTemplates
  _templateCache.set(key, templates)
  return templates
}

/* ---------------------------------------------------------------------------
 * Types + reads
 * ------------------------------------------------------------------------- */

export interface CurveState {
  realKas: number
  tokenReserve: number
  graduated: boolean
  vKas: number
  graduationKas: number
  creatorFeeBps: number
  platformFeeBps: number
  graduationFeeBps: number
  dexCreatorFeeBps: number
  dexPlatformFeeBps: number
  dexLpFeeBps?: number
  poolLockedShares?: number
  devFundBps?: number
  [key: string]: any
}

export interface Kcc20Token {
  tick: string
  name: string
  decimals: number
  covenantId: string
  curveCovenantId: string
  poolCovenantId: string | null
  graduated: boolean
  price?: number
  change24h?: number
  volume24h?: number
  volumeTotal?: number
  trades24h?: number
  cpState: CurveState | null
  /** Static baked-pattern params from the registry `curveParams` (vKas, fees). */
  curveParams: CurveState | null
  reserveKas?: string
  tokenReserve: string
  toTokenInfo(): TokenInfo
}

export interface Kcc20Balance {
  tick: string
  balance: string
  dec: number
  parsed: number
}

export interface Kcc20Quote {
  id: string
  tokenOut: string
  net?: string
  totalIn: string
  price: number
  path: "curve" | "pool"
  graduated: boolean
  quote?: any
}

let _marketCache: Kcc20Token[] | null = null

function curveStateFromRecord(r: any | null): CurveState | null {
  if (!r) return null
  return {
    realKas: 0,
    tokenReserve: 0,
    graduated: false,
    vKas: r.vKas ?? 0,
    graduationKas: r.graduationKas ?? 0,
    creatorFeeBps: r.creatorFeeBps ?? 0,
    platformFeeBps: r.platformFeeBps ?? 0,
    graduationFeeBps: r.graduationFeeBps ?? 0,
    dexCreatorFeeBps: r.dexCreatorFeeBps ?? 0,
    dexPlatformFeeBps: r.dexPlatformFeeBps ?? 0,
    dexLpFeeBps: r.dexLpFeeBps ?? 0,
    poolLockedShares: r.poolLockedShares ?? 0,
    devFundBps: r.devFundBps ?? 0,
  }
}

/** Discover every chain-verified KCC-20 token (registry tokenlist, verified tier only). */
export async function discoverTokens(): Promise<Kcc20Token[]> {
  if (_marketCache) return _marketCache
  const list = await registry().tokenlist()
  const out = list.tokens
    .filter((t) => t.extensions.chainVerified && t.covenantId)
    .map((t) => ({
      tick: t.symbol,
      name: t.name,
      decimals: t.decimals,
      covenantId: t.covenantId,
      curveCovenantId: t.extensions.curveCovenantId ?? "",
      poolCovenantId: t.extensions.poolCovenantId,
      graduated: t.extensions.graduated,
      price: 0,
      cpState: null,
      curveParams: curveStateFromRecord(t.extensions.curveParams),
      tokenReserve: "0",
      toTokenInfo(): TokenInfo {
        return {
          ticker: t.symbol,
          name: t.name,
          decimals: t.decimals,
          icon: t.logoURI || "K",
          isKrc20: true,
          address: t.covenantId,
        }
      },
    }))
  _marketCache = out
  return out
}

/** Live balances for one address across all KCC-20 tokens (indexer address tokenlist). */
export async function getBalances(address: string): Promise<Kcc20Balance[]> {
  const rows = await indexer().tokenlist(address)
  return rows.map((r) => ({
    tick: r.tick,
    balance: r.balance,
    dec: r.dec,
    parsed: Number(r.balance) / Math.pow(10, r.dec),
  }))
}

/** Live token record: price, graduation state, covenant ids, live curve/pool reserves.
 *  The indexer's cpState carries ONLY {realKas, tokenReserve, graduated}; the static
 *  baked curve params (vKas, graduationKas, fee bps) come from the registry `curveParams`
 *  and are merged here so quotes are correct (docs/INTEGRATION.md §4). */
export async function getToken(tick: string): Promise<Kcc20Token | null> {
  try {
    const t = await indexer().token(tick.toLowerCase())
    const live = t.cpState as unknown as CurveState
    let baked: CurveState | null = null
    if (_marketCache) {
      baked = _marketCache.find((m) => m.tick.toLowerCase() === tick.toLowerCase())?.curveParams ?? null
    }
    if (!baked) {
      try {
        const list = await registry().tokenlist()
        const entry = list.tokens.find((e) => e.symbol.toLowerCase() === tick.toLowerCase())
        baked = curveStateFromRecord(entry?.extensions.curveParams ?? null)
      } catch { /* keep null */ }
    }
    const merged: CurveState = { ...(baked ?? {}), ...live }
    return {
      tick: t.tick,
      name: t.name,
      decimals: t.dec,
      covenantId: t.covenantId,
      curveCovenantId: t.curveCovenantId,
      poolCovenantId: t.poolCovenantId,
      graduated: t.graduated,
      price: t.price ?? 0,
      change24h: t.change24h,
      volume24h: t.volume24h,
      volumeTotal: t.volumeTotal,
      trades24h: t.trades24h,
      cpState: merged,
      curveParams: baked,
      reserveKas: t.reserveKas,
      tokenReserve: t.tokenReserve,
      toTokenInfo(): TokenInfo {
        return {
          ticker: t.tick,
          name: t.name,
          decimals: t.dec,
          icon: "K",
          isKrc20: true,
          address: t.covenantId,
        }
      },
    }
  } catch {
    return null
  }
}

function curveStateForQuote(s: CurveState): kron.curve.CpState {
  return {
    realKas: BigInt(s.realKas ?? 0),
    tokenReserve: BigInt(s.tokenReserve ?? 0),
    vKas: BigInt(s.vKas ?? 0),
    graduationKas: BigInt(s.graduationKas ?? 0),
    creatorFeeBps: BigInt(s.creatorFeeBps ?? 0),
    platformFeeBps: BigInt(s.platformFeeBps ?? 0),
    devFundBps: BigInt(s.devFundBps ?? 0),
  }
}

/* ---------------------------------------------------------------------------
 * Quotes
 * ------------------------------------------------------------------------- */

/** Live pool reserves + fee params for a graduated token. */
async function poolParams(tick: string, s: CurveState | null) {
  const idx = indexer()
  const head = await idx.poolhead(tick.toLowerCase())
  const tok = await getToken(tick)
  const state: kron.poolCp.PoolCpState = {
    kasReserve: BigInt(head.reserves.kasReserve) * kron.curve.SCALE,
    tokenReserve: BigInt(head.reserves.tokenReserve),
    tokenCovid: kron.genesis.covidToBytes(tok?.covenantId ?? ""),
    totalShares: BigInt(head.reserves.totalShares),
    lpCovid: head.reserves.lpCovid ? kron.genesis.covidToBytes(head.reserves.lpCovid) : new Uint8Array(),
  }
  const params: kron.poolCp.PoolCpParams = {
    creatorFeeOwner: new Uint8Array(32),
    platformFeeOwner: new Uint8Array(32),
    creatorFeeBps: BigInt(s?.dexCreatorFeeBps ?? 0),
    platformFeeBps: BigInt(s?.dexPlatformFeeBps ?? 0),
    lpFeeBps: BigInt(s?.dexLpFeeBps ?? 0),
    lockedShares: BigInt(s?.poolLockedShares ?? 0),
  }
  return { state, params, reserves: head.reserves }
}

/** Quote buying tokens with `kasAmount` (KAS) against live covenant state. */
export async function quoteBuy(tick: string, kasAmount: number): Promise<Kcc20Quote | null> {
  const tok = await getToken(tick)
  if (!tok || !tok.cpState) return null
  const kasIn = BigInt(Math.max(1, Math.round(kasAmount * SOMPI_PER_KAS)))
  const s = curveStateForQuote(tok.cpState)

  if (!tok.graduated) {
    const q = kron.curve.quoteCpBuy(s, kasIn)
    if (!q) return null
    return {
      id: asymId(tick, kasAmount, "buy", "curve"),
      tokenOut: q.tokenOut.toString(),
      totalIn: kasAmount.toFixed(6),
      price: kron.curve.cpPrice(s),
      path: "curve",
      graduated: false,
      quote: q,
    }
  }

  const { state, params } = await poolParams(tick, tok.cpState)
  const q = kron.poolCpV3.quotePoolV3Buy(state, params, kasIn)
  if (!q) return null
  return {
    id: asymId(tick, kasAmount, "buy", "pool"),
    tokenOut: q.tokenOut.toString(),
    totalIn: kasAmount.toFixed(6),
    price: Number(kasIn) / Number(q.tokenOut),
    path: "pool",
    graduated: true,
    quote: q,
  }
}

/** Quote selling `tokenAmount` tokens for KAS. */
export async function quoteSell(tick: string, tokenAmount: number): Promise<Kcc20Quote | null> {
  const tok = await getToken(tick)
  if (!tok || !tok.cpState) return null
  const tokenIn = BigInt(Math.max(1, Math.round(tokenAmount * Math.pow(10, tok.decimals))))

  if (!tok.graduated) {
    const s = curveStateForQuote(tok.cpState)
    const q = kron.curve.quoteCpSell(s, tokenIn)
    if (!q || q.net <= 0n) return null
    return {
      id: asymId(tick, tokenAmount, "sell", "curve"),
      tokenOut: (Number(q.net) / SOMPI_PER_KAS).toFixed(8),
      net: q.net.toString(),
      totalIn: tokenAmount.toFixed(8),
      price: kron.curve.cpPrice(s),
      path: "curve",
      graduated: false,
      quote: q,
    }
  }

  const { state, params } = await poolParams(tick, tok.cpState)
  const q = kron.poolCpV3.quotePoolV3Sell(state, params, tokenIn)
  if (!q || q.net <= 0n) return null
  return {
    id: asymId(tick, tokenAmount, "sell", "pool"),
    tokenOut: (Number(q.net) / SOMPI_PER_KAS).toFixed(8),
    net: q.net.toString(),
    totalIn: tokenAmount.toFixed(8),
    price: Number(q.net) / Number(tokenIn),
    path: "pool",
    graduated: true,
    quote: q,
  }
}

let _nonce = 0
function asymId(tick: string, amt: number, side: string, path: string): string {
  _nonce = (_nonce + 1) % 2 ** 31
  return `${tick}-${side}-${path}-${Date.now()}-${_nonce}`
}

/* ---------------------------------------------------------------------------
 * Wallet bridge
 * ------------------------------------------------------------------------- */

export interface WalletBridge {
  getAddress(): Promise<string | null>
  getPublicKey(): Promise<string>
  signPskt(txJsonString: string, signInputs: { index: number; sighashType: number }[]): Promise<string>
  getUtxoEntries?(address?: string): Promise<{ outpoint: { transactionId: string; index: number }; entry: { amount: string } }[]>
  pushTx?(txJsonString: string, priorityFee?: number): Promise<string>
}

export function walletBridge(): WalletBridge | null {
  const w = (window as any).kasware as (KasWareProvider & any) | undefined
  if (!w) return null
  return {
    getAddress: async () => {
      const accounts = await w.getAccounts?.()
      return accounts?.[0] ?? null
    },
    getPublicKey: async () => String(await w.getPublicKey()),
    signPskt: async (txJsonString, signInputs) =>
      w.signPskt({ txJsonString, options: { signInputs } }),
    getUtxoEntries: w.getUtxoEntries,
    pushTx: w.pushTx,
  }
}
/* ---------------------------------------------------------------------------
 * Assembling + signing (the shared write path)
 * ------------------------------------------------------------------------- */

export interface AssembledResult {
  asm: kron.spend.AssembledNativeTx
  pskt: { txJsonString: string; signInputs: { index: number; sighashType: number }[] }
  networkFee: bigint
}

/**
 * The canonical sequence (docs/INTEGRATION.md §5): assemble with a GUESS fee, size the
 * real fee against that assembly, RE-ASSEMBLE with the real fee (the change output's
 * value changes every funding input's sighash — only this second assembly may be signed).
 */
export async function assembleAndSize(
  spend: kron.spend.CovenantSpend,
  fundingEntries: kron.spend.FundingEntry[],
  changeAddress: string,
  ref = PARTNER_REF,
): Promise<AssembledResult> {
  const k = await getKaspa()
  let asm = kron.spend.assembleNativeTx(k, {
    spend,
    fundingEntries,
    changeAddress,
    networkFee: 10_000n,
    ref,
  })
  const networkFee = kron.spend.estimateNativeFee(k, NETWORK_ID, asm, FEE_RATE)
  asm = kron.spend.assembleNativeTx(k, {
    spend,
    fundingEntries,
    changeAddress,
    networkFee,
    ref,
  })
  const pskt = kron.spend.toPsktJson(asm)
  return { asm, pskt, networkFee }
}

/** Funding entries from the wallet's own P2PK UTXOs (largest first, capped count). */
export async function fundingEntriesFromWallet(
  bridge: WalletBridge,
  address: string,
  maxEntries = 4,
): Promise<kron.spend.FundingEntry[]> {
  const raw = await bridge.getUtxoEntries?.(address)
  if (!raw?.length) throw new Error("No spendable P2PK UTXOs in wallet")
  return raw
    .map((f) => ({
      outpoint: { transactionId: f.outpoint.transactionId, index: f.outpoint.index },
      amount: BigInt(f.entry?.amount ?? 0),
    }))
    .filter((f) => f.amount >= kron.spend.COVENANT_DUST)
    .sort((a, b) => (a.amount < b.amount ? 1 : -1))
    .slice(0, maxEntries)
}

/** Sign the P2PK funding inputs via the wallet, then submit (wallet pushTx → node wRPC). */
export async function signAndSubmit(bridge: WalletBridge, pskt: AssembledResult["pskt"]): Promise<string> {
  const signed = await bridge.signPskt(pskt.txJsonString, pskt.signInputs)
  const txid = await submitSigned(signed)
  return txid
}

/** Submit a signed tx JSON — via the wallet's `pushTx` if available, else the node wRPC. */
export async function submitSigned(txJsonString: string, rpc?: RpcClient): Promise<string> {
  const w = (window as any).kasware
  if (w?.pushTx) {
    try {
      const txid = await w.pushTx(txJsonString, 0)
      if (txid) return txid
    } catch {
      /* fall through to wRPC */
    }
  }
  const r = rpc ?? (await getRpc())
  const k = await getKaspa()
  const tx = k.Transaction.deserializeFromSafeJSON(txJsonString)
  const res = await r.submitTransaction({ transaction: tx })
  return res.transactionId
}

/* ---------------------------------------------------------------------------
 * Transfers (kcc20.send)
 * ------------------------------------------------------------------------- */

/**
 * Send `amount` tokens to a P2PK `toAddress` (the KCC-20 standard only supports P2PK
 * owners). The sender's token UTXOs are decoded with `decodeKcc20Redeem` (template +
 * state), the spend is built with `buildKcc20Send`, funded by the user's own P2PK
 * UTXOs, and the wallet signs ONLY the funding inputs.
 */
export async function transfer(
  tick: string,
  amount: number,
  toAddress: string,
  bridge: WalletBridge,
): Promise<{ txid: string; fee: string }> {
  const k = await getKaspa()
  const address = await bridge.getAddress()
  if (!address) throw new Error("Wallet not connected")

  const tok = await getToken(tick)
  if (!tok) throw new Error(`Token ${tick} not found`)
  const decimals = tok.decimals || DEFAULT_DECIMALS

  const sendAmount = BigInt(Math.round(amount * Math.pow(10, decimals)))
  if (sendAmount <= 0n) throw new Error("Amount must be positive")

  let recipientPub: Uint8Array
  try {
    recipientPub = hexToBytes(k.XOnlyPublicKey.fromAddress(new k.Address(toAddress)).toString())
  } catch {
    throw new Error("Recipient must be a P2PK kaspa address (KCC-20 does not support P2SH owners)")
  }

  const idx = indexer()
  const utxos = await idx.tokenUtxos(tick.toLowerCase(), address)
  if (!utxos.length) throw new Error(`No ${tick.toUpperCase()} UTXOs at this address`)

  const decoded = utxos.map((u) => {
    const d = kron.kcc20.decodeKcc20Redeem(hexToBytes(u.redeemScriptHex))
    return { utxo: u, ...d }
  })
  decoded.sort((a, b) => (a.state.amount < b.state.amount ? 1 : -1))

  const picked: typeof decoded = []
  let covered = 0n
  for (const d of decoded) {
    picked.push(d)
    covered += d.state.amount
    if (covered >= sendAmount) break
  }
  if (covered < sendAmount) throw new Error(`Balance ${covered.toString()} < send ${sendAmount.toString()}`)

  const tpl = picked[0].template
  const senderTokens = picked.map((d) => ({
    transactionId: d.utxo.outpoint.transactionId,
    index: d.utxo.outpoint.index,
    value: kron.spend.COVENANT_DUST,
    state: d.state,
  }))
  const presenceWitnessIdx = senderTokens.length // [token 0..N-1, funding[0] = N]
  const spend = kron.kcc20.buildKcc20Send(
    k,
    tpl,
    senderTokens,
    recipientPub,
    sendAmount,
    presenceWitnessIdx,
    tok.covenantId,
  )

  const funding = await fundingEntriesFromWallet(bridge, address)
  const { asm, pskt, networkFee } = await assembleAndSize(spend, funding, address)
  const txid = await signAndSubmit(bridge, pskt)
  return { txid, fee: (Number(networkFee) / SOMPI_PER_KAS).toFixed(6) }
}

/* ---------------------------------------------------------------------------
 * Curve trades (pre-graduation)
 * ------------------------------------------------------------------------- */

/**
 * Live curve head via the SEQUENCER (docs §4 "Curve state") — the curve's address moves
 * on every trade, so the sequencer's in-flight head is the correct spendable outpoint.
 * Falls back to the indexer-derived address retry loop when the sequencer is unreachable.
 */
async function liveCurve(tick: string, tok: Kcc20Token) {
  const k = await getKaspa()
  const templates = await getTemplates(tick)
  const curveCovidBytes = kron.genesis.covidToBytes(tok.curveCovenantId)
  const s = tok.cpState!

  const seq = sequencer()
  let curveUtxo: kron.curveCp.CpCurveUtxo | null = null
  let inventory: kron.curveCp.CpInventoryUtxo | null = null
  try {
    const head = await seq.curveHead(tok.curveCovenantId)
    if (head.ok && head.head) {
      curveUtxo = {
        transactionId: head.head.poolOutpoint.transactionId,
        index: head.head.poolOutpoint.index,
        realKas: BigInt(head.head.reserves.realKas),
        state: {
          graduated: false,
          tokenCovid: curveCovidBytes,
          tokenReserve: BigInt(head.head.reserves.tokenReserve),
        },
      }
      inventory = {
        transactionId: head.head.poolTokenOutpoint.transactionId,
        index: head.head.poolTokenOutpoint.index,
        value: 0n,
        amount: BigInt(head.head.reserves.tokenReserve),
      }
    }
  } catch {
    curveUtxo = null
  }

  if (!curveUtxo || !inventory) {
    // Indexer fallback: derive the two covenant addresses from live state + retry (5× 1.5s).
    const reserveState: kron.curveCp.CpCurveState = {
      graduated: false,
      tokenCovid: curveCovidBytes,
      tokenReserve: BigInt(s.tokenReserve ?? 0),
    }
    const curveAddr = kron.curveCp.cpAddress(k, templates.curve, reserveState, NETWORK_ID)
    const rpc = await getRpc()
    const curveLookup = await rpc.getUtxosByAddresses({ addresses: [curveAddr] })
    const curveEntry = curveLookup.entries?.find((e) => BigInt(e.amount ?? 0) > 0n)
    if (!curveEntry) throw new Error("Could not locate the live curve UTXO — retry in a moment")
    const curveValue = BigInt(curveEntry.amount ?? 0)
    curveUtxo = { transactionId: curveEntry.outpoint.transactionId, index: curveEntry.outpoint.index, realKas: curveValue, state: reserveState }
    // The curve's token inventory is a KCC-20 UTXO covenant-owned by the curve covid (the minter branch);
    // its native value is the token carrier — read it, don't assume. Look it up among the curve's outputs.
    const tokenAmount = BigInt(s.tokenReserve ?? 0)
    const inventoryAddr = kron.kcc20.kcc20Address(k, templates.token, kron.kcc20.covenantIdOwned(curveCovidBytes, tokenAmount, true), NETWORK_ID)
    const invLookup = await rpc.getUtxosByAddresses({ addresses: [inventoryAddr] })
    const invEntry = invLookup.entries?.find((e) => BigInt(e.amount ?? 0) > 0n)
    inventory = {
      transactionId: invEntry?.outpoint?.transactionId ?? curveEntry.outpoint.transactionId,
      index: invEntry?.outpoint?.index ?? curveEntry.outpoint.index,
      value: BigInt(invEntry?.amount ?? 0),
      amount: tokenAmount,
    }
  }

  if (!curveUtxo) throw new Error("Could not locate the live curve UTXO — retry in a moment")
  if (!inventory) throw new Error("Could not locate the curve inventory UTXO")
  return { templates, curveCovidBytes, curveUtxo, inventory }
}

/** Buy on the curve (pre-graduation). `kasAmount` in KAS. */
export async function buyOnCurve(
  tick: string,
  kasAmount: number,
  bridge: WalletBridge,
): Promise<{ txid: string; fee: string }> {
  const k = await getKaspa()
  const address = await bridge.getAddress()
  if (!address) throw new Error("Wallet not connected")

  const tok = await getToken(tick)
  if (!tok || !tok.cpState) throw new Error(`Token ${tick} has no live state`)
  if (tok.graduated) throw new Error(`${tick} has graduated — use a pool swap`)

  const q = await quoteBuy(tick, kasAmount)
  if (!q?.quote) throw new Error("Buy quote failed — try a smaller amount")
  const kasIn = BigInt(q.quote.kasIn)
  const tokenOut = BigInt(q.quote.tokenOut)

  const { templates, curveCovidBytes, curveUtxo, inventory } = await liveCurve(tick, tok)
  const buyerPub = hexToBytes(await bridge.getPublicKey())

  const spend = kron.curveCp.buildCpBuy(
    k,
    templates.curve,
    templates.token,
    curveUtxo,
    inventory,
    curveCovidBytes,
    buyerPub,
    kasIn,
    tokenOut,
  )

  const funding = await fundingEntriesFromWallet(bridge, address)
  const { pskt, networkFee } = await assembleAndSize(spend, funding, address)
  const txid = await signAndSubmit(bridge, pskt)
  return { txid, fee: (Number(networkFee) / SOMPI_PER_KAS).toFixed(6) }
}

/** Sell on the curve (pre-graduation). `tokenAmount` in whole tokens. */
export async function sellOnCurve(
  tick: string,
  tokenAmount: number,
  bridge: WalletBridge,
): Promise<{ txid: string; fee: string }> {
  const k = await getKaspa()
  const address = await bridge.getAddress()
  if (!address) throw new Error("Wallet not connected")

  const tok = await getToken(tick)
  if (!tok || !tok.cpState) throw new Error(`Token ${tick} has no live state`)
  if (tok.graduated) throw new Error(`${tick} has graduated — use a pool swap`)
  const decimals = tok.decimals || DEFAULT_DECIMALS
  const tokenIn = BigInt(Math.round(tokenAmount * Math.pow(10, decimals)))

  const q = await quoteSell(tick, tokenAmount)
  if (!q?.quote) throw new Error("Sell quote failed — amount too small to sell?")
  const kasOut = BigInt(q.quote.net)

  const { templates, curveCovidBytes, curveUtxo, inventory } = await liveCurve(tick, tok)

  const utxos = await indexer().tokenUtxos(tick.toLowerCase(), address)
  if (!utxos.length) throw new Error(`No ${tick.toUpperCase()} UTXOs at this address`)
  const decoded = utxos.map((u) => ({ utxo: u, ...kron.kcc20.decodeKcc20Redeem(hexToBytes(u.redeemScriptHex)) }))
  decoded.sort((a, b) => (a.state.amount < b.state.amount ? 1 : -1))
  const picked = decoded.filter((d) => d.state.amount >= tokenIn)
  const chosen = picked[0] ?? decoded[0]

  const traderPub = hexToBytes(await bridge.getPublicKey())
  const sellerTokens = [
    {
      transactionId: chosen.utxo.outpoint.transactionId,
      index: chosen.utxo.outpoint.index,
      value: kron.spend.COVENANT_DUST,
      state: chosen.state,
    },
  ]
  const presenceWitnessIdx = sellerTokens.length // [token 0, funding[0] = 1]
  const spend = kron.curveCp.buildCpSell(
    k,
    templates.curve,
    templates.token,
    curveUtxo,
    sellerTokens,
    inventory,
    curveCovidBytes,
    traderPub,
    tokenIn,
    kasOut,
    presenceWitnessIdx,
  )

  const funding = await fundingEntriesFromWallet(bridge, address)
  const { pskt, networkFee } = await assembleAndSize(spend, funding, address)
  const txid = await signAndSubmit(bridge, pskt)
  return { txid, fee: (Number(networkFee) / SOMPI_PER_KAS).toFixed(6) }
}

/* ---------------------------------------------------------------------------
 * Pool swaps (post-graduation)
 * ------------------------------------------------------------------------- */

/** Live pool UTXO + reserves for a graduated token (sequencer head, else indexer poolhead). */
async function livePool(tick: string, tok: Kcc20Token) {
  const k = await getKaspa()
  const templates = await getTemplates(tick)
  const poolCovidBytes = kron.genesis.covidToBytes(tok.poolCovenantId ?? "")

  let pool: kron.poolCpV3.PoolCpV3Utxo | null = null
  let reserves = tok.cpState as CurveState

  const seq = sequencer()
  try {
    const head = await seq.head(tok.poolCovenantId ?? "")
    if (head.head) {
      reserves = {
        ...reserves,
        realKas: Number(head.head.reserves.kasReserve),
        tokenReserve: Number(head.head.reserves.tokenReserve),
        poolTotalShares: Number(head.head.reserves.totalShares),
        poolLpCovid: head.head.reserves.lpCovid ?? undefined,
      }
      pool = {
        transactionId: head.head.poolOutpoint.transactionId,
        index: head.head.poolOutpoint.index,
        state: {
          kasReserve: BigInt(head.head.reserves.kasReserve) * kron.curve.SCALE,
          tokenReserve: BigInt(head.head.reserves.tokenReserve),
          tokenCovid: kron.genesis.covidToBytes(tok.covenantId),
          totalShares: BigInt(head.head.reserves.totalShares),
          lpCovid: head.head.reserves.lpCovid ? kron.genesis.covidToBytes(head.head.reserves.lpCovid) : new Uint8Array(),
        },
        tokenUtxo: {
          transactionId: head.head.poolTokenOutpoint.transactionId,
          index: head.head.poolTokenOutpoint.index,
          value: 0n,
        },
      }
    }
  } catch {
    pool = null
  }

  if (!pool) {
    const idx = indexer()
    const head = await idx.poolhead(tick.toLowerCase())
    pool = {
      transactionId: head.pool.transactionId,
      index: head.pool.index,
      state: {
        kasReserve: BigInt(head.reserves.kasReserve) * kron.curve.SCALE,
        tokenReserve: BigInt(head.reserves.tokenReserve),
        tokenCovid: kron.genesis.covidToBytes(tok.covenantId),
        totalShares: BigInt(head.reserves.totalShares),
        lpCovid: head.reserves.lpCovid ? kron.genesis.covidToBytes(head.reserves.lpCovid) : new Uint8Array(),
      },
      tokenUtxo: {
        transactionId: head.poolToken.transactionId,
        index: head.poolToken.index,
        value: 0n,
      },
    }
  }

  return { templates, poolCovidBytes, pool }
}

/** Swap KAS → tokens on the pool (post-graduation). `kasAmount` in KAS. */
export async function swapKasForToken(
  tick: string,
  kasAmount: number,
  bridge: WalletBridge,
): Promise<{ txid: string; fee: string }> {
  const k = await getKaspa()
  const address = await bridge.getAddress()
  if (!address) throw new Error("Wallet not connected")

  const tok = await getToken(tick)
  if (!tok) throw new Error(`Token ${tick} not found`)
  if (!tok.graduated || !tok.poolCovenantId) throw new Error(`${tick} has not graduated — use the curve`)

  const q = await quoteBuy(tick, kasAmount)
  if (!q?.quote) throw new Error("Swap quote failed")
  const { templates, poolCovidBytes, pool } = await livePool(tick, tok)

  const traderPub = hexToBytes(await bridge.getPublicKey())
  const spend = kron.poolCpV3.buildPoolV3SwapKasForToken(
    k,
    templates.pool,
    templates.token,
    templates.params,
    pool,
    poolCovidBytes,
    traderPub,
    q.quote,
  )

  const funding = await fundingEntriesFromWallet(bridge, address)
  const { pskt, networkFee } = await assembleAndSize(spend, funding, address)
  const txid = await signAndSubmit(bridge, pskt)
  return { txid, fee: (Number(networkFee) / SOMPI_PER_KAS).toFixed(6) }
}

/** Swap tokens → KAS on the pool (post-graduation). `tokenAmount` in whole tokens. */
export async function swapTokenForKas(
  tick: string,
  tokenAmount: number,
  bridge: WalletBridge,
): Promise<{ txid: string; fee: string }> {
  const k = await getKaspa()
  const address = await bridge.getAddress()
  if (!address) throw new Error("Wallet not connected")

  const tok = await getToken(tick)
  if (!tok) throw new Error(`Token ${tick} not found`)
  if (!tok.graduated || !tok.poolCovenantId) throw new Error(`${tick} has not graduated — use the curve`)
  const decimals = tok.decimals || DEFAULT_DECIMALS
  const tokenIn = BigInt(Math.round(tokenAmount * Math.pow(10, decimals)))

  const q = await quoteSell(tick, tokenAmount)
  if (!q?.quote) throw new Error("Swap quote failed")
  const { templates, poolCovidBytes, pool } = await livePool(tick, tok)

  const utxos = await indexer().tokenUtxos(tick.toLowerCase(), address)
  if (!utxos.length) throw new Error(`No ${tick.toUpperCase()} UTXOs at this address`)
  const decoded = utxos.map((u) => ({ utxo: u, ...kron.kcc20.decodeKcc20Redeem(hexToBytes(u.redeemScriptHex)) }))
  const chosen = decoded[0]

  const traderPub = hexToBytes(await bridge.getPublicKey())
  const traderTokens = [
    {
      transactionId: chosen.utxo.outpoint.transactionId,
      index: chosen.utxo.outpoint.index,
      value: kron.spend.COVENANT_DUST,
      state: chosen.state,
    },
  ]
  const presenceWitnessIdx = traderTokens.length // [token 0, funding[0] = 1]
  const spend = kron.poolCpV3.buildPoolV3SwapTokenForKas(
    k,
    templates.pool,
    templates.token,
    templates.params,
    pool,
    poolCovidBytes,
    traderPub,
    traderTokens,
    q.quote,
    presenceWitnessIdx,
  )

  const funding = await fundingEntriesFromWallet(bridge, address)
  const { pskt, networkFee } = await assembleAndSize(spend, funding, address)
  const txid = await signAndSubmit(bridge, pskt)
  return { txid, fee: (Number(networkFee) / SOMPI_PER_KAS).toFixed(6) }
}

/* ---------------------------------------------------------------------------
 * Utils
 * ------------------------------------------------------------------------- */

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
}

export function formatKcc20Amount(balance: string, dec: number): string {
  const val = Number(balance) / Math.pow(10, dec)
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(2) + "M"
  if (val >= 1_000) return (val / 1_000).toFixed(2) + "K"
  return val.toLocaleString("en-US", { maximumFractionDigits: 8 })
}

export function sompiToKas(sompi: string | bigint): number {
  return Number(BigInt(sompi)) / SOMPI_PER_KAS
}

export function kasToSompi(kas: number): bigint {
  return BigInt(Math.max(0, Math.round(kas * SOMPI_PER_KAS)))
}
