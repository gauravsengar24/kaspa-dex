import * as kron from "@kronsdk/kron-sdk"
import { loadKaspa, type Kaspa } from "@kronsdk/kron-sdk/wasm"
import type { TokenInfo } from "../types"

/**
 * The browser wasm loader accepts an optional `wasmUrl`; the package's node type
 * surface (what tsc sees) declares no args — widen it so we can pin the CDN URL.
 */
const loadKaspaBrowser = loadKaspa as (wasmUrl?: string | URL) => Promise<Kaspa>

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

/**
 * KRON's REST APIs are CORS-pinned to kron.technology, so on deployed origins (the
 * HF Space) the browser can't reach them directly. The FastAPI backend exposes a
 * same-origin relay at /kron/{api|idx|seq}/... — when served from the app origin the
 * SDK endpoints are rewritten to the relay. Outside that origin (local dev, node
 * scripts) we use the canonical URLs. kasCov/static snapshots remain as fallback.
 */
const isRelayedOrigin =
  typeof location !== "undefined" &&
  (/\.hf\.space$/i.test(location.hostname) || /^kaspadex/i.test(location.hostname))

const INDEXER_URL = isRelayedOrigin
  ? `${location.origin}/kron/idx`
  : "https://idx.kron.technology/v1/kcc20"
const REGISTRY_URL = isRelayedOrigin
  ? `${location.origin}/kron/api`
  : "https://api.kron.technology"
const SEQUENCER_URL = isRelayedOrigin
  ? `${location.origin}/kron/seq`
  : "https://seq.kron.technology"
const TEMPLATE_URL = isRelayedOrigin
  ? `${location.origin}/kron/api/api/native/cp-template`
  : "https://api.kron.technology/api/native/cp-template"
const NODE_WRPC = "wss://node.kron.technology"
const NETWORK_ID = "mainnet"
const SOMPI_PER_KAS = 100_000_000
const FEE_RATE = 100
const PARTNER_REF = "kaspadex"
const DEFAULT_DECIMALS = 8

/**
 * Kaspa WASM SDK (11.5MB) served from GitHub jsDelivr CDN instead of the slow HF
 * static origin — the SDK's built-in 30s timeout was being hit on cold loads.
 * Mirror lives at tag `kaspa-wasm` (origin/master only; never pushed to HF).
 * Must stay in lockstep with @kronsdk/kron-sdk's bundled kaspa_bg.wasm.
 */
const KASPA_WASM_URL =
  "https://cdn.jsdelivr.net/gh/gauravsengar24/kaspa-dex@kaspa-wasm/vendor/kaspa_bg.wasm"
const WASM_MAX_ATTEMPTS = 3

let _kaspaPromise: Promise<Kaspa> | null = null
export async function getKaspa(): Promise<Kaspa> {
  if (_kaspaPromise) return _kaspaPromise
  let lastErr: unknown = null
  for (let attempt = 0; attempt < WASM_MAX_ATTEMPTS; attempt++) {
    try {
      _kaspaPromise = loadKaspaBrowser(KASPA_WASM_URL)
      return await _kaspaPromise
    } catch (err) {
      lastErr = err
      _kaspaPromise = null
      if (attempt < WASM_MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
      }
    }
  }
  throw lastErr
}

/** Warm-load the Kaspa WASM in the background (idempotent, non-blocking). */
export function warmKaspaWasm(): void {
  getKaspa().catch(() => undefined)
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

/**
 * KRON's REST API is CORS-pinned to kron.technology, so browsers on other origins
 * (our HF app) can't reach the registry/template/indexer endpoints directly. The
 * STATIC pieces (token registry + compiled covenant templates + baked fee params)
 * are snapshotted into /kron-snapshot.json and served from a CDN; the LIVE piece
 * (curve/pool reserves) comes from kasCov (CORS-open) or the node wRPC (no CORS).
 */

const SNAPSHOT_URL =
  "https://cdn.jsdelivr.net/gh/gauravsengar24/kaspa-dex@kron-snapshot/public/kron-snapshot.json"

let _snapshotPromise: Promise<{ registry: RegistryRecord[]; compile: Record<string, any> } | null> | null = null
async function loadSnapshot(): Promise<{ registry: RegistryRecord[]; compile: Record<string, any> } | null> {
  const base = await fetch(SNAPSHOT_URL)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!base) return null
  const compile: Record<string, any> = {}
  for (const part of (base.parts ?? [])) {
    const p = await fetch(`https://cdn.jsdelivr.net/gh/gauravsengar24/kaspa-dex@kron-snapshot/public/${part}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    if (p?.compile) Object.assign(compile, p.compile)
  }
  return { registry: base.registry ?? [], compile }
}
function snapshot(): Promise<any> {
  _snapshotPromise ??= loadSnapshot()
  return _snapshotPromise
}

interface RegistryRecord {
  network: string
  covenantId: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  extensions: {
    chainVerified?: boolean
    curveCovenantId: string
    poolCovenantId: string | null
    graduated: boolean
    curveParams: Record<string, any>
    templateVersion?: Record<string, any>
  }
}

async function registryTokens(): Promise<RegistryRecord[]> {
  try {
    const list = (await registry().tokenlist()) as any
    if (list?.tokens?.length) return list.tokens as RegistryRecord[]
  } catch { /* KRON CORS-blocked → fall through to snapshot */ }
  const snap = await snapshot()
  return snap?.registry ?? []
}

async function snapshotTemplate(tick: string): Promise<any | null> {
  const snap = await snapshot()
  return snap?.compile?.[tick.toLowerCase()] ?? null
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

/** Convert a server blob ({scriptHex, stateStart, params}) into SDK template shapes. */
function compileFromBody(body: any): any {
  const b = (s: any) => (typeof s === "string" ? hexToBytes(s) : new Uint8Array(s ?? []))
  const p = body?.params ?? body?.pool?.params
  const fee = (x: any, y: any) => BigInt(x ?? y ?? 0)
  return {
    token: { script: b(body?.token?.scriptHex ?? body?.token?.script), stateStart: Number(body?.token?.stateStart ?? 0) },
    pool: {
      script: b(body?.pool?.scriptHex ?? body?.pool?.script),
      stateStart: Number(body?.pool?.stateStart ?? 0),
      canonicalInventoryRequired: body?.pool?.canonicalLpInventory ?? body?.canonicalLpInventory ?? true,
    },
    curve: { script: b(body?.curve?.scriptHex ?? body?.curve?.script), stateStart: Number(body?.curve?.stateStart ?? 0) },
    params: p
      ? {
          creatorFeeOwner: b(p.creatorFeeOwner),
          platformFeeOwner: b(p.platformFeeOwner),
          creatorFeeBps: fee(p.dexCreatorFeeBps, p.creatorFeeBps),
          platformFeeBps: fee(p.dexPlatformFeeBps, p.platformFeeBps),
          lpFeeBps: fee(p.dexLpFeeBps, p.lpFeeBps),
          lockedShares: BigInt(p.poolLockedShares ?? p.lockedShares ?? 0),
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

  const registryEntry = (await registryTokens()).find((t) => t.symbol.toLowerCase() === key)
  let compiled: any = null

  if (registryEntry) {
    try {
      const res = await fetch(TEMPLATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(registryEntry.extensions.curveParams ?? {}),
          tokenCovid: registryEntry.covenantId,
          templateVersion: registryEntry.extensions.templateVersion,
        }),
      })
      if (res.ok) {
        const body = await res.json()
        compiled = compileFromBody(body)
      }
    } catch {
      /* cross-origin → fall through to snapshot */
    }
  }

  if (!compiled || !compiled.token?.script?.length) {
    const snap = await snapshotTemplate(tick)
    if (snap) compiled = compileFromBody(snap)
  }
  if (!compiled?.token?.script?.length) {
    throw new Error(`Templates unavailable for ${tick} (KRON registry is CORS-restricted and no snapshot entry)`)
  }
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
  const list = await registryTokens()
  const out = list
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

// kasCov live market state (CORS-enabled) — primary browser source for reserves/prices.
const KASCOV_MARKETS_URL = "https://kascov.io/data/mainnet/markets"

interface KascovMarketRow {
  market: {
    phase: string
    reserve_sompi?: number
    spot_num_sompi?: number
    spot_den?: number
    program: {
      token_covenant_id?: string
      token_reserve?: number
      v_kas_units?: number
      graduation_kas_sompi?: number
      kas_reserve_sompi?: number
      shares?: number
      lp_token_covenant_id?: string
    }
  }
}

let _kascovMarkets: { at: number; rows: KascovMarketRow[] } | null = null
async function kascovMarkets(): Promise<KascovMarketRow[]> {
  const fresh = !!(_kascovMarkets && Date.now() - _kascovMarkets.at < 10_000)
  if (fresh) return _kascovMarkets!.rows
  const res = await fetch(KASCOV_MARKETS_URL)
  if (!res.ok) return _kascovMarkets?.rows ?? []
  const js = await res.json()
  _kascovMarkets = { at: Date.now(), rows: js.markets ?? [] }
  return _kascovMarkets.rows
}

/**
 * Build a token's live record from kasCov (CORS-open) instead of the KRON indexer
 * when the latter is unreachable from the browser. kasCov program exposes the same
 * on-chain reserves (sompi) the curve/pool math needs.
 */
async function getTokenFromKascov(tick: string): Promise<Kcc20Token | null> {
  const list = await registryTokens()
  const entry = list.find((e) => e.symbol.toLowerCase() === tick.toLowerCase())
  if (!entry) return null
  const rows = await kascovMarkets()
  const row = rows.find((r) => (r.market.program.token_covenant_id ?? "") === entry.covenantId)
  if (!row) return null
  const m = row.market
  const p = m.program
  const graduated = m.phase === "graduated"
  const baked = curveStateFromRecord(entry.extensions.curveParams)
  const realKas = m.reserve_sompi ?? p.kas_reserve_sompi ?? 0
  const live = {
    ...(baked ?? {}),
    realKas,
    tokenReserve: p.token_reserve ?? 0,
    graduated,
    vKas: p.v_kas_units ?? baked?.vKas ?? 0,
    graduationKas: p.graduation_kas_sompi ?? baked?.graduationKas ?? 0,
  } as CurveState
  const price = m.spot_num_sompi && m.spot_den ? m.spot_num_sompi / SOMPI_PER_KAS / m.spot_den : undefined
  covidBytesStrict(entry, "covenantId")
  covidBytesStrict(entry.extensions, "curveCovenantId")
  covidBytesStrict(entry.extensions, "poolCovenantId")
  return {
    tick: entry.symbol,
    name: entry.name,
    decimals: entry.decimals,
    covenantId: entry.covenantId,
    curveCovenantId: entry.extensions.curveCovenantId ?? "",
    poolCovenantId: entry.extensions.poolCovenantId,
    graduated,
    price: price ?? 0,
    change24h: 0,
    volume24h: 0,
    volumeTotal: 0,
    trades24h: 0,
    cpState: live,
    curveParams: baked,
    reserveKas: String(realKas),
    tokenReserve: String(p.token_reserve ?? 0),
    toTokenInfo(): TokenInfo {
      return {
        ticker: entry.symbol,
        name: entry.name,
        decimals: entry.decimals,
        icon: "K",
        isKrc20: true,
        address: entry.covenantId,
      }
    },
  }
}

/** Live balances for one address across all KCC-20 tokens (indexer address tokenlist). */
export async function getBalances(address: string): Promise<Kcc20Balance[]> {
  try {
    const rows = await indexer().tokenlist(address)
    return rows.map((r) => ({
      tick: r.tick,
      balance: r.balance,
      dec: r.dec,
      parsed: Number(r.balance) / Math.pow(10, r.dec),
    }))
  } catch {
    return []
  }
}

/** Live token record: price, graduation state, covenant ids, live curve/pool reserves.
 *  The indexer's cpState carries ONLY {realKas, tokenReserve, graduated}; the static
 *  baked curve params (vKas, graduationKas, fee bps) come from the registry `curveParams`
 *  and are merged here so quotes are correct (docs/INTEGRATION.md §4). */
export async function getToken(tick: string): Promise<Kcc20Token | null> {
  try {
    const res = await indexer().token(tick.toLowerCase())
    const t = Array.isArray(res) ? res[0] : res
    if (!t) return null
    const live = t.cpState as unknown as CurveState
    let baked: CurveState | null = null
    if (_marketCache) {
      baked = _marketCache.find((m) => m.tick.toLowerCase() === tick.toLowerCase())?.curveParams ?? null
    }
    if (!baked) {
      try {
        const list = await registryTokens()
        const entry = list.find((e) => e.symbol.toLowerCase() === tick.toLowerCase())
        baked = curveStateFromRecord(entry?.extensions.curveParams ?? null)
      } catch { /* keep null */ }
    }
    const merged: CurveState = { ...(baked ?? {}), ...live }
    covidBytesStrict(t, "covenantId")
    covidBytesStrict(t, "curveCovenantId")
    covidBytesStrict(t, "poolCovenantId")
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
    /* indexer unreachable from this origin (KRON CORS) → kasCov live state */
    try {
      return await getTokenFromKascov(tick)
    } catch {
      return null
    }
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
  const tok = await getToken(tick)
  const tokenCovid = kron.genesis.covidToBytes(tok?.covenantId ?? "")
  let state: kron.poolCp.PoolCpState
  let reserves: any

  try {
    const idx = indexer()
    const head = await idx.poolhead(tick.toLowerCase())
    covidBytesStrict(head.reserves, "lpCovid")
    reserves = head.reserves
    state = {
      kasReserve: BigInt(head.reserves.kasReserve),
      tokenReserve: BigInt(head.reserves.tokenReserve),
      tokenCovid,
      totalShares: BigInt(head.reserves.totalShares),
      lpCovid: head.reserves.lpCovid ? kron.genesis.covidToBytes(head.reserves.lpCovid) : new Uint8Array(),
    }
  } catch {
    // indexer CORS-restricted → kasCov graduated-pool program state
    const rows = await kascovMarkets()
    const list = await registryTokens()
    const entry = list.find((e) => e.symbol.toLowerCase() === tick.toLowerCase())
    const row = rows.find((r) => (r.market.program.token_covenant_id ?? "") === entry?.covenantId)
    const p = row?.market?.program
    if (!p) throw new Error(`no pool state for ${tick}`)
    covidBytesStrict(p, "lp_token_covenant_id")
    reserves = {
      kasReserve: String(p.kas_reserve_sompi ?? 0),
      tokenReserve: String(p.token_reserve ?? 0),
      totalShares: String(p.shares ?? 0),
      lpCovid: p.lp_token_covenant_id ?? "",
    }
    state = {
      kasReserve: BigInt(p.kas_reserve_sompi ?? 0) / kron.curve.SCALE,
      tokenReserve: BigInt(p.token_reserve ?? 0),
      tokenCovid,
      totalShares: BigInt(p.shares ?? 0),
      lpCovid: p.lp_token_covenant_id ? kron.genesis.covidToBytes(p.lp_token_covenant_id) : new Uint8Array(),
    }
  }
  const params: kron.poolCp.PoolCpParams = {
    creatorFeeOwner: new Uint8Array(32),
    platformFeeOwner: new Uint8Array(32),
    creatorFeeBps: BigInt(s?.dexCreatorFeeBps ?? 0),
    platformFeeBps: BigInt(s?.dexPlatformFeeBps ?? 0),
    lpFeeBps: BigInt(s?.dexLpFeeBps ?? 0),
    lockedShares: BigInt(s?.poolLockedShares ?? 0),
  }
  return { state, params, reserves }
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
    getPublicKey: async () => {
      const raw = String(await w.getPublicKey()).trim()
      const hex = raw.replace(/^0x/i, "")
      const bytes = hexToBytes(hex)
      if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) {
        return bytesToHex(bytes.slice(1))
      }
      if (bytes.length === 65 && bytes[0] === 0x04) {
        return bytesToHex(bytes.slice(1))
      }
      if (bytes.length === 32) return hex
      throw new Error(`KasWare getPublicKey returned ${bytes.length} bytes (expected a 32/33/65-byte secp256k1 key)`)
    },
    signPskt: async (txJsonString, signInputs) => {
      try {
        return await w.signPskt({ txJsonString, options: { signInputs } })
      } catch (e: any) {
        const detail = e instanceof Error ? e.message : typeof e === "string" ? e : safeStringify(e)
        try {
          ;(window as any).__lastSwapTxJson = txJsonString
          ;(window as any).__lastSwapTxSignInputs = JSON.stringify(signInputs)
          ;(window as any).__lastSwapWalletVersion = String(((window as any).kasware as any)?.version?.() ?? (window as any).kasware?.version ?? "unknown")
        } catch { /* noop */ }
        throw new Error(`KasWare rejected the swap signature: ${detail}`)
      }
    },
    getUtxoEntries: async (address: string) => {
      try {
        return await w.getUtxoEntries(address)
      } catch (e: any) {
        const detail = e instanceof Error ? e.message : typeof e === "string" ? e : safeStringify(e)
        throw new Error(`KasWare getUtxoEntries failed: ${detail}`)
      }
    },
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
 * Debug instrumentation (bundle identity + assemble diagnostics).
 * `__bundleId` resolves to the built chunk URL (e.g. .../assets/index-XXXX.js) so we
 * can prove which deploy a browser is actually running — stale-cache mismatches
 * (the `new zv` vs `new np` class-name discrepancy) are the current prime suspect.
 */
if (typeof window !== "undefined") {
  try {
    const w = window as unknown as Record<string, unknown>
    if (!w.__bundleId) w.__bundleId = import.meta.url
  } catch {
    /* non-module context: keep undefined */
  }
}

const COVID_RE = /^[0-9a-fA-F]{64}$/

/**
 * Strict 64-hex covid/covenant-id validator. The whole error chain
 * ("Error converting property 'covenant': Slice must have the length of Hash")
 * traces back to an ODD-LENGTH hex id: `hexToBytes` silently drops the trailing
 * char (63→31 bytes), `hexOf3` serializes back to 62 chars, and the assembled
 * binding's Hash fails. Fail loud + capture instead of corrupting silently. */
export function covidBytesStrict(tok: unknown, field: string): Uint8Array {
  const v = (tok as any)?.[field]
  if (v == null || v === "") return new Uint8Array()
  if (typeof v !== "string" || !COVID_RE.test(v)) {
    try {
      ;(window as any).__lastCovidError = {
        field,
        value: String(v),
        len: String(v).length,
        bundleId: (window as any).__bundleId,
        at: new Date().toISOString(),
      }
    } catch {
      /* noop */
    }
    throw new Error(
      `KCC-20 abort: ${field} is not a 64-char hex covenant id (got ${String(v).length} chars: ${v})`,
    )
  }
  return hexToBytes(v)
}

/** Capture the pre-assemble `spend` for diagnosis when assembly throws. */
function captureSpendForDebug(
  spend: kron.spend.CovenantSpend,
  fundingEntries: kron.spend.FundingEntry[],
  changeAddress: string,
): void {
  try {
    const w = window as unknown as Record<string, unknown>
    w.__lastAssembleSpendOutputs = (spend.outputs ?? []).map((o: any, i: number) => ({
      i,
      value: String(o?.value ?? ""),
      hasBinding: !!o?.binding,
      bindingAuthorizingInput: o?.binding?.authorizingInput ?? null,
      covid: o?.binding?.covid ?? null,
      covidLen: typeof o?.binding?.covid === "string" ? o.binding.covid.length : null,
      isPlainObject: o != null && typeof o === "object" && (o.constructor?.name ?? "?") === "Object",
    }))
    w.__lastAssembleFunding = (fundingEntries ?? []).map((f: any, i: number) => ({
      i,
      amount: String(f?.amount ?? null),
      spkType: f?.scriptPublicKey?.constructor?.name ?? typeof f?.scriptPublicKey,
    }))
    w.__lastAssembleChangeAddress = changeAddress
    w.__lastAssembleAt = new Date().toISOString()
  } catch {
    /* diagnostics must never break the swap */
  }
}

/** Replicate the SDK's `new TransactionOutput(.., new HashCRD(covid))` wrapper per output to
 *  find which element/conversion the wasm-transaction constructor rejects in the browser. */
function captureWrappedOutputsForDebug(spend: kron.spend.CovenantSpend, k: Kaspa): void {
  try {
    const w = window as unknown as Record<string, unknown>
    const wrapped: unknown[] = []
    ;(spend.outputs ?? []).forEach((o: any, i: number) => {
      const rec: Record<string, unknown> = { i }
      try {
        const hash = new k.Hash(o?.binding?.covid ?? "")
        rec.hashOk = true
        rec.hashLen = hash.toString().length
        rec.hashCtor = (hash.constructor as unknown as { name?: string })?.name ?? "?"
        const out = new k.TransactionOutput(
          BigInt(o?.value ?? 0),
          o?.scriptPublicKey,
          new k.CovenantBinding(o?.binding?.authorizingInput ?? 0, hash),
        )
        rec.wrapOk = true
        rec.outputCtor = (out?.constructor as unknown as { name?: string })?.name ?? "?"
        rec.isInstanceTO = out instanceof k.TransactionOutput
        const cov = (out as any)?.covenant
        rec.covCtor = cov?.constructor?.name ?? typeof cov
        rec.covIsInst = cov instanceof k.CovenantBinding
        const cid = cov?.covenantId
        rec.cidCtor = cid?.constructor?.name ?? typeof cid
        rec.cidIsInst = cid instanceof k.Hash
        rec.spkCtor = (o?.scriptPublicKey as any)?.constructor?.name ?? typeof o?.scriptPublicKey
        rec.spkIsInst = o?.scriptPublicKey instanceof k.ScriptPublicKey
        wrapped.push(out)
      } catch (err2) {
        rec.ok = false
        rec.wrapErr = err2 instanceof Error ? `${err2.name}: ${err2.message}` : String(err2)
      }
      ;((w[`__wrappedOut_${i}`] ??= []) as unknown[]).push(rec)
    })
    try {
      const probe = new k.Transaction({
        version: 1,
        inputs: [],
        outputs: wrapped as never[],
        lockTime: 0n,
        gas: 0n,
        payload: "",
        subnetworkId: "0000000000000000000000000000000000000000",
      })
      w.__wrappedTxProbe = { ok: true, mass: (probe as unknown as { storageMass?: bigint }).storageMass?.toString?.() ?? "?" }
    } catch (err) {
      w.__wrappedTxProbe = { ok: false, err: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
    }
    /* Shape matrix: which covenant descriptor form does the wasm accept in THIS runtime? */
    try {
      const spk = (spend.outputs?.[0] as any)?.scriptPublicKey ?? k.payToAddressScript("kaspa:qpagqzgydc7ynkv9zegpjz0wac4vxvgurdjgx5egtfey964q6xenyplgj4lgr")
      const covidHex = (spend.outputs?.[0] as any)?.binding?.covid ?? "0000000000000000000000000000000000000000"
      const shapes: Record<string, unknown> = {}
      const makeOut = (covenant: unknown) => ({ value: 100000000000000n, scriptPublicKey: spk, covenant })
      shapes.plainHex = (() => {
        try {
          new k.Transaction({ version: 1, inputs: [], outputs: [makeOut({ authorizingInput: 0, covenantId: covidHex }) as never], lockTime: 0n, gas: 0n, payload: "", subnetworkId: "0000000000000000000000000000000000000000" })
          return "OK"
        } catch (e: any) { return `${e?.name}: ${e?.message}` }
      })()
      shapes.plainBytes = (() => {
        try {
          const b = new Uint8Array(32)
          for (let i = 0; i < 32; i++) b[i] = parseInt(covidHex.slice(i * 2, i * 2 + 2), 16)
          new k.Transaction({ version: 1, inputs: [], outputs: [makeOut({ authorizingInput: 0, covenantId: b }) as never], lockTime: 0n, gas: 0n, payload: "", subnetworkId: "0000000000000000000000000000000000000000" })
          return "OK"
        } catch (e: any) { return `${e?.name}: ${e?.message}` }
      })()
      shapes.plainStrBytes = (() => {
        try {
          const b = new Uint8Array(32)
          for (let i = 0; i < 32; i++) b[i] = parseInt(covidHex.slice(i * 2, i * 2 + 2), 16)
          new k.Transaction({ version: 1, inputs: [], outputs: [makeOut({ authorizingInput: 0, covenantId: { data: b } }) as never], lockTime: 0n, gas: 0n, payload: "", subnetworkId: "0000000000000000000000000000000000000000" })
          return "OK"
        } catch (e: any) { return `${e?.name}: ${e?.message}` }
      })()
      shapes.plainHashStr = (() => {
        try {
          new k.Transaction({ version: 1, inputs: [], outputs: [makeOut({ authorizingInput: 0, covenantId: covidHex }) as never], lockTime: 0n, gas: 0n, payload: "", subnetworkId: "0000000000000000000000000000000000000000" })
          return "OK"
        } catch (e: any) { return `${e?.name}: ${e?.message}` }
      })()
      w.__covShapeProbe = shapes
    } catch {
      /* ignore */
    }
  } catch {
    /* diagnostics must never break the swap */
  }
}

export async function assembleAndSize(
  spend: kron.spend.CovenantSpend,
  fundingEntries: kron.spend.FundingEntry[],
  changeAddress: string,
  ref = PARTNER_REF,
): Promise<AssembledResult> {
  captureSpendForDebug(spend, fundingEntries, changeAddress)
  const k = await getKaspa()
  captureWrappedOutputsForDebug(spend, k)
  try {
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
  } catch (err) {
    try {
      ;(window as unknown as Record<string, unknown>).__lastAssembleError =
        err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
    } catch {
      /* noop */
    }
    throw err
  }
}

/** Funding entries from the wallet's own P2PK UTXOs (largest first, capped count).
 *  Each entry carries the SAME address's P2PK scriptPublicKey — without it the
 *  serializer omits `scriptPublicKey` from the funding inputs and a re-parse
 *  (wallet `signPskt` / our wRPC submit) throws "...does not contain scriptPublicKey". */
export async function fundingEntriesFromWallet(
  bridge: WalletBridge,
  address: string,
  maxEntries = 4,
): Promise<kron.spend.FundingEntry[]> {
  const raw = await bridge.getUtxoEntries?.(address)
  if (!raw?.length) throw new Error("No spendable P2PK UTXOs in wallet")
  const k = await getKaspa()
  const scriptPublicKey = k.payToAddressScript(address)
  return raw
    .map((f) => ({
      outpoint: { transactionId: f.outpoint.transactionId, index: f.outpoint.index },
      amount: BigInt(f.entry?.amount ?? 0),
      scriptPublicKey,
      blockDaaScore: 0n,
      isCoinbase: false,
    }))
    .filter((f) => f.amount >= kron.spend.COVENANT_DUST)
    .sort((a, b) => (a.amount < b.amount ? 1 : -1))
    .slice(0, maxEntries)
}

/** Sign the P2PK funding inputs via the wallet, then submit (wallet pushTx → node wRPC). */
export async function signAndSubmit(bridge: WalletBridge, pskt: AssembledResult["pskt"]): Promise<string> {
  const signed = await bridge.signPskt(pskt.txJsonString, pskt.signInputs)
  const txid = await submitSigned(signed, undefined, pskt.txJsonString)
  return txid
}

/**
 * Submit a signed tx JSON — via the wallet's `pushTx` if available, else the node wRPC.
 * The wallet returns its OWN safe-JSON schema for covenant outputs; a different Kaspa build
 * may re-serialize it in a shape our vendored wasm can't parse. When that happens we never
 * feed the wallet's JSON to our deserializer: we merge ONLY the `signatureScript` hex from
 * the wallet's output into our ORIGINAL (pre-sign) JSON — which our wasm parses — and submit
 * that via wRPC. The signature script is plain hex data in every schema, so the merge is
 * version-agnostic.
 */
export async function submitSigned(txJsonString: string, rpc?: RpcClient, originalUnsignedJson?: string): Promise<string> {
  const w = (window as any).kasware
  if (w?.pushTx) {
    try {
      const txid = await w.pushTx(txJsonString, 0)
      if (txid) return txid
    } catch (e: any) {
      try {
        ;(window as any).__lastPushTxError = e instanceof Error ? `${e.message}\n${e.stack}` : String(e)
      } catch { /* noop */ }
      /* fall through to wRPC */
    }
  }
  const r = rpc ?? (await getRpc())
  const k = await getKaspa()
  try {
    let json = txJsonString
    if (originalUnsignedJson) {
      const signedObj = JSON.parse(txJsonString)
      const unsignedObj = JSON.parse(originalUnsignedJson)
      for (const si of signedObj.inputs ?? []) {
        const idx = typeof si?.index === "number" ? si.index : -1
        if (idx >= 0 && unsignedObj.inputs?.[idx] && typeof si?.signatureScript === "string" && si.signatureScript) {
          unsignedObj.inputs[idx] = { ...unsignedObj.inputs[idx], signatureScript: si.signatureScript }
        }
      }
      json = JSON.stringify(unsignedObj)
      try {
        ;(window as any).__lastMergedSubmitJson = json
      } catch { /* noop */ }
    }
    const tx = k.Transaction.deserializeFromSafeJSON(json)
    const res = await r.submitTransaction({ transaction: tx })
    return res.transactionId
  } catch (e: any) {
    try {
      ;(window as any).__lastSubmitTxJson = txJsonString
    } catch { /* noop */ }
    throw e
  }
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
      covidBytesStrict(head.head.reserves, "lpCovid")
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
          kasReserve: BigInt(head.head.reserves.kasReserve),
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
    try {
      const idx = indexer()
      const head = await idx.poolhead(tick.toLowerCase())
      covidBytesStrict(head.reserves, "lpCovid")
      pool = {
        transactionId: head.pool.transactionId,
        index: head.pool.index,
        state: {
          kasReserve: BigInt(head.reserves.kasReserve),
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
    } catch {
      /* sequencer + indexer both unreachable (KRON CORS) → kasCov state + node wRPC lookup */
      const { state } = await poolParams(tick, reserves)
      const poolWon = kron.poolCpV3.poolCpV3Address(k, templates.pool, state, NETWORK_ID)
      const rpc = await getRpc()
      const lookup = await rpc.getUtxosByAddresses({ addresses: [poolWon] })
      const entry = lookup.entries?.find((e) => BigInt(e.amount ?? 0) > 0n)
      if (!entry) throw new Error("Could not locate the live pool UTXO — retry in a moment")
      const invAddr = kron.kcc20.kcc20Address(
        k,
        templates.token,
        kron.kcc20.covenantIdOwned(poolCovidBytes, BigInt(state.tokenReserve), true),
        NETWORK_ID,
      )
      const invLookup = await rpc.getUtxosByAddresses({ addresses: [invAddr] })
      const invEntry = invLookup.entries?.find((e) => BigInt(e.amount ?? 0) > 0n)
      pool = {
        transactionId: entry.outpoint.transactionId,
        index: entry.outpoint.index,
        state,
        tokenUtxo: {
          transactionId: invEntry?.outpoint?.transactionId ?? entry.outpoint.transactionId,
          index: invEntry?.outpoint?.index ?? entry.outpoint.index,
          value: 0n,
        },
      }
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

function safeStringify(e: unknown): string {
  if (e == null) return "null"
  try {
    const s = JSON.stringify(e)
    return s && s.length < 400 ? s : s?.slice(0, 400) ?? String(e)
  } catch {
    return String(e)
  }
}

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
