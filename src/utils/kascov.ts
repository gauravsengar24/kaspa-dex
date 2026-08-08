/**
 * KasCov API — open, keyless Kaspa covenant + verified token-market data
 * (https://kascov.io · openapi.json).
 *
 * Exact monetary values are JSON integers (sompi); prices are
 * numerator/denominator pairs (spot_num_sompi / spot_den = KAS sompi per token
 * unit). Everything here is read directly from the indexer — no mock values.
 */

export const KASCOV_API = "https://kascov.io"
export const KASCOV_NETWORK = "mainnet"
export const SOMPI_PER_KAS = 100_000_000

/* ---------------------------------------------------------------------------
 * Types (mirror the OpenAPI shapes)
 * ------------------------------------------------------------------------- */

export interface KascovPrice {
  kasUsd: number
  source: string
  updatedAtMs: number
}

export interface KascovEvent {
  acceptingDaa: number
  covenantId: string
  kind: string
  seq: number
  txIndex: number
  txid: string
}

export interface KascovLive {
  network: string
  processedDaa: number
  generatedAtMs: number
  recentEvents: KascovEvent[]
}

export interface KascovTokenMeta {
  covenantId: string
  name: string
  supply: number
  holders: number
  heldByCovenant: number
  heldByScript: number
  heldByWallet: number
  liveValue: number
  minted: number
  burned: number
  alive: boolean
  status: string
  template: string
  lastActivityDaa: number
  unresolvableCells: number
  fields: Record<string, string>
}

export interface KascovProgram {
  covenantId: string
  skeleton: string
  tokenCovenantId: string
  programHash: string
  invariantOk: boolean
  exercisedTrades: number
  tokenReserve?: number
  vKasUnits?: number
  graduationKasSompi?: number
  kasReserveSompi?: number
  lpTokenCovenantId?: string
  shares?: number
}

export interface KascovMarket {
  marketId: string
  phase: "bonding" | "graduated"
  program: KascovProgram
  spotNumSompi: number
  spotDen: number
  reserveSompi: number
  exitValueSompi: number
  gradProgressBps?: number
  lastBaseAmount?: number
  lastQuoteSompi?: number
  lastSide?: "buy" | "sell"
  lastDaa?: number
  lastTimeMs?: number
  change24hBps?: number
  trades24h?: number
  volume24hSompi?: number
  token: KascovTokenMeta
  tradesTotal?: number
  marketUrl?: string
}

export interface KascovTrade {
  txid: string
  seq: number
  acceptingDaa: number
  acceptingTimeMs: number
  side: "buy" | "sell"
  tokenId: string
  marketCovenantId: string
  baseAmount: number
  baseBefore: number
  baseAfter: number
  quoteSompi: number
  counterparty?: string
  counterpartyAddress?: string
  coCovenants: number
}

export interface KascovDigest {
  activeNow: number
  births: number
  burns: number
  moves: number
  valueBornSompi: number
  windowHours: number
  tipDaa: number
  tipAtMs: number
  generatedAtMs: number
}

export interface KascovActivityBucket {
  daa: number
  moves: number
  births: number
  burns: number
}

/* ---------------------------------------------------------------------------
 * HTTP helpers
 * ------------------------------------------------------------------------- */

async function getJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const u = new URL(`${KASCOV_API}/data/${KASCOV_NETWORK}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(u)
  if (!res.ok) throw new Error(`KasCov ${path} failed (HTTP ${res.status})`)
  return (await res.json()) as T
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0
}

/* ---------------------------------------------------------------------------
 * Endpoints
 * ------------------------------------------------------------------------- */

/** GET /data/price.json — live KAS reference price. */
export async function fetchKasPrice(): Promise<KascovPrice> {
  const res = await fetch(`${KASCOV_API}/data/price.json`)
  if (!res.ok) throw new Error(`KasCov price failed (HTTP ${res.status})`)
  const d = (await res.json()) as { kas_usd?: number; source?: string; updated_at_ms?: number }
  return { kasUsd: num(d.kas_usd), source: d.source ?? "kraken", updatedAtMs: num(d.updated_at_ms) }
}

/** GET /data/{network}-live.json — small live network snapshot. */
export async function fetchLive(): Promise<KascovLive> {
  const res = await fetch(`${KASCOV_API}/data/${KASCOV_NETWORK}-live.json`)
  if (!res.ok) throw new Error(`KasCov live failed (HTTP ${res.status})`)
  const d = (await res.json()) as Record<string, unknown>
  return {
    network: String(d.network ?? KASCOV_NETWORK),
    processedDaa: num(d.processed_daa),
    generatedAtMs: num(d.generated_at_ms),
    recentEvents: Array.isArray(d.recent_events) ? (d.recent_events as KascovEvent[]) : [],
  }
}

function parseMarketRows(d: Record<string, unknown>): KascovMarket[] {
  const rows = Array.isArray(d.markets) ? (d.markets as any[]) : Array.isArray(d.pools) ? (d.pools as any[]) : []
  const out: KascovMarket[] = []
  for (const r of rows) {
    const m = r.market ?? r
    out.push({
      marketId: String(r.market_id ?? m.covenant_id ?? m.market_id ?? ""),
      phase: m.phase === "graduated" ? "graduated" : "bonding",
      program: {
        covenantId: String(m.program?.covenant_id ?? ""),
        skeleton: String(m.program?.skeleton ?? "unknown"),
        tokenCovenantId: String(m.program?.token_covenant_id ?? ""),
        programHash: String(m.program?.program_hash ?? ""),
        invariantOk: Boolean(m.program?.invariant_ok),
        exercisedTrades: num(m.program?.exercised_trades),
        tokenReserve: num(m.program?.token_reserve),
        vKasUnits: num(m.program?.v_kas_units),
        graduationKasSompi: num(m.program?.graduation_kas_sompi),
        kasReserveSompi: num(m.program?.kas_reserve_sompi),
        lpTokenCovenantId: String(m.program?.lp_token_covenant_id ?? ""),
        shares: num(m.program?.shares),
      },
      spotNumSompi: num(m.spot_num_sompi),
      spotDen: num(m.spot_den),
      reserveSompi: num(m.reserve_sompi),
      exitValueSompi: num(m.exit_value_sompi),
      gradProgressBps: num(m.grad_progress_bps),
      lastBaseAmount: num(m.last_base_amount),
      lastQuoteSompi: num(m.last_quote_sompi),
      lastSide: (m.last_side as "buy" | "sell") || undefined,
      lastDaa: num(m.last_daa),
      lastTimeMs: num(m.last_time_ms),
      change24hBps: num(m.change_24h_bps),
      trades24h: num(m.trades_24h),
      volume24hSompi: num(m.volume_24h_sompi),
      token: {
        covenantId: String(r.token?.covenant_id ?? ""),
        name: String(r.token?.name ?? "anonymous"),
        supply: num(r.token?.supply),
        holders: num(r.token?.holders),
        heldByCovenant: num(r.token?.held_by_covenant),
        heldByScript: num(r.token?.held_by_script),
        heldByWallet: num(r.token?.held_by_wallet),
        liveValue: num(r.token?.live_value),
        minted: num(r.token?.minted),
        burned: num(r.token?.burned),
        alive: Boolean(r.token?.alive),
        status: String(r.token?.status ?? "verified"),
        template: String(r.token?.template ?? "KCC20 token"),
        lastActivityDaa: num(r.token?.last_activity_daa),
        unresolvableCells: num(r.token?.unresolved_cells),
        fields: (r.token?.fields as Record<string, string>) ?? {},
      },
      tradesTotal: num(r.trades_total),
      marketUrl: String(r.market_url ?? ""),
    })
  }
  return out
}

function mapTrade(t: any): KascovTrade {
  return {
    txid: String(t.txid ?? ""),
    seq: num(t.seq),
    acceptingDaa: num(t.accepting_daa),
    acceptingTimeMs: num(t.accepting_time_ms),
    side: (t.side === "sell" ? "sell" : "buy") as "buy" | "sell",
    tokenId: String(t.token_id ?? ""),
    marketCovenantId: String(t.market_covenant_id ?? ""),
    baseAmount: num(t.base_amount),
    baseBefore: num(t.base_before),
    baseAfter: num(t.base_after),
    quoteSompi: num(t.quote_sompi),
    counterparty: String(t.counterparty ?? ""),
    counterpartyAddress: String(t.counterparty_address ?? ""),
    coCovenants: num(t.co_covenants),
  }
}

/** GET /data/{network}/markets — verified bonding curves + graduated pools. */
export async function fetchMarkets(opts: { phase?: "bonding" | "graduated"; limit?: number } = {}): Promise<KascovMarket[]> {
  const d = await getJson<Record<string, unknown>>("/markets", { phase: opts.phase ?? "", limit: opts.limit ?? 100 })
  return parseMarketRows(d)
}

/** GET /data/{network}/pools — verified graduated pools. */
export async function fetchPools(limit = 100): Promise<KascovMarket[]> {
  const d = await getJson<Record<string, unknown>>("/pools", { limit })
  return parseMarketRows(d)
}

/** GET /data/{network}/market/{id} — one market with recent trades (for sparklines). */
export async function fetchMarket(id: string): Promise<{ market: KascovMarket; recentTrades: KascovTrade[]; tradesTotal: number }> {
  const d = (await getJson<Record<string, unknown>>(`/market/${id}`)) as any
  return {
    market: parseMarketRows({ markets: [d] })[0],
    recentTrades: Array.isArray(d.recent_trades) ? (d.recent_trades as any[]).map(mapTrade) : [],
    tradesTotal: num(d.trades_total),
  }
}

/** GET /data/{network}/trades — admitted trades across all tokens (newest first).
 *  `beforeSeq`/`beforeToken` resume behind a compound cursor (older trades). */
export async function fetchTrades(
  opts: { limit?: number; marketId?: string; tokenId?: string; beforeSeq?: number; beforeToken?: string } = {},
): Promise<KascovTrade[]> {
  const d = await getJson<Record<string, unknown>>("/trades", {
    limit: opts.limit ?? 40,
    market_id: opts.marketId ?? "",
    token_id: opts.tokenId ?? "",
    ...(opts.beforeSeq != null ? { before_token: opts.beforeToken ?? opts.tokenId ?? "", before_seq: opts.beforeSeq } : {}),
  })
  return Array.isArray(d.trades) ? (d.trades as any[]).map(mapTrade) : []
}

/** GET /data/{network}/digest.json — 24h network digest. */
export async function fetchDigest(): Promise<KascovDigest> {
  const d = await getJson<Record<string, unknown>>("/digest.json")
  return {
    activeNow: num(d.active_now),
    births: num(d.births),
    burns: num(d.burns),
    moves: num(d.moves),
    valueBornSompi: num(d.value_born),
    windowHours: num(d.window_hours),
    tipDaa: num(d.tip_daa),
    tipAtMs: num(d.tip_at_ms),
    generatedAtMs: num(d.generated_at_ms),
  }
}

/** GET /data/{network}/activity.json — covenant activity buckets. */
export async function fetchActivity(range: "1h" | "6h" | "24h" | "48h" | "all" = "24h"): Promise<KascovActivityBucket[]> {
  const d = await getJson<Record<string, unknown>>("/activity.json", { range })
  return Array.isArray(d.buckets)
    ? (d.buckets as any[]).map((b) => ({
        daa: num(b.daa),
        moves: num(b.moves),
        births: num(b.births),
        burns: num(b.burns),
      }))
    : []
}

/* ---------------------------------------------------------------------------
 * Pricing helpers
 * ------------------------------------------------------------------------- */

/** Spot price in KAS per token unit. */
export function marketSpotKas(m: KascovMarket): number {
  if (!m.spotNumSompi || !m.spotDen) return 0
  return m.spotNumSompi / SOMPI_PER_KAS / m.spotDen
}

/** Spot price in USD per token unit. */
export function marketSpotUsd(m: KascovMarket, kasUsd: number): number {
  return marketSpotKas(m) * kasUsd
}

/** Total KAS reserved (liquidity) held by the curve or pool. */
export function marketReserveKas(m: KascovMarket): number {
  return m.reserveSompi / SOMPI_PER_KAS
}

/** 24h volume in KAS. */
export function marketVolumeKas(m: KascovMarket): number {
  return (m.volume24hSompi ?? 0) / SOMPI_PER_KAS
}

/** 24h volume in USD. */
export function marketVolumeUsd(m: KascovMarket, kasUsd: number): number {
  return marketVolumeKas(m) * kasUsd
}

/** Market cap (exit value) in USD. */
export function marketMcUsd(m: KascovMarket, kasUsd: number): number {
  return (m.exitValueSompi / SOMPI_PER_KAS) * kasUsd
}

/** Latest executed price in USD from the market's last trade. */
export function marketLastPriceUsd(m: KascovMarket, kasUsd: number): number {
  if (!m.lastBaseAmount || !m.lastQuoteSompi) return 0
  return ((m.lastQuoteSompi / SOMPI_PER_KAS) * kasUsd) / m.lastBaseAmount
}

export function mcapToPct(bps: number): number {
  return bps / 100
}

/** Derive a compact price series from a market's recent trades (ascending time). */
export function sparklineFromTrades(recentTrades: KascovTrade[], max = 14): number[] {
  const prices = recentTrades
    .filter((t) => t.baseAmount > 0 && t.quoteSompi > 0)
    .map((t) => t.quoteSompi / SOMPI_PER_KAS / t.baseAmount)
    .reverse()
  if (!prices.length) return []
  const bin = Math.max(1, Math.ceil(prices.length / max))
  const reduced: number[] = []
  for (let i = 0; i < prices.length; i += bin) {
    const slice = prices.slice(i, i + bin)
    reduced.push(slice[slice.length - 1] ?? slice[0])
  }
  return reduced.slice(-max)
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K"
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 })
}