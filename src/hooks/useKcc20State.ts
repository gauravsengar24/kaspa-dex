import { useCallback, useEffect, useMemo, useState } from "react"
import { indexer, type Kcc20Token } from "../utils/kcc20"
import {
  fetchKasPrice,
  fetchLive,
  fetchMarkets,
  fetchPools,
  fetchTrades,
  fetchDigest,
  fetchActivity,
  fetchMarket,
  marketReserveKas,
  marketVolumeUsd,
  marketSpotUsd,
  marketMcUsd,
  marketLastPriceUsd,
  marketSpotKas,
  sparklineFromTrades,
  fmtCompact,
  type KascovMarket,
  type KascovTrade,
  type KascovActivityBucket,
} from "../utils/kascov"

/**
 * State-first market data — everything here is read LIVE from the KasCov
 * indexer (verified, hash-proven Kaspa covenant state) and falls back to the
 * KRON indexer + node if KasCov is unreachable. Nothing is mocked.
 *
 * A single module-level store is shared by every consumer (Header, Overview,
 * Swap) so the whole app polls once, not once per component.
 */

export interface LivePool {
  id: number
  pair: string
  tvl: string
  tvlUsd: number
  vol: string
  volUsd: number
  apr: string
  aprRaw: number
  data: number[]
  tick: string
  graduated: boolean
  kasReserve: number
  tokenReserve: number
  price: number
  priceUsd: number
  change24h: number
  changePct: number
  covenantId: string
  trades24h: number
  holders: number
  mcapUsd: number
  gradProgress: number
  lastSide?: string
  lastTimeMs?: number
}

export interface LiveTrade {
  id: number
  kind: "Buy" | "Sell"
  amount: string
  price: string
  when: string
  tick: string
  txid: string
  baseAmount: number
  priceUsd: number
}

export interface L1StateInfo {
  direct: boolean
  rpcUrl: string
  indexerUrl: string
  daaScore: number | null
  synced: boolean
  tokenTotal: number | null
  lastSync: number | null
  dataSource: "kascov" | "kron" | "offline"
  kasUsd: number | null
  priceSource: string | null
  priceUpdatedAt: number | null
  tipDaa: number | null
  activeCovenants: number | null
  moves24h: number | null
  births24h: number | null
  burns24h: number | null
  valueBorn24h: number | null
  activity: KascovActivityBucket[]
}

interface Store {
  tokens: Kcc20Token[]
  pools: LivePool[]
  trades: LiveTrade[]
  info: L1StateInfo
  loading: boolean
  error: string | null
}

const initialState: Store = {
  tokens: [],
  pools: [],
  trades: [],
  info: {
    direct: true,
    rpcUrl: "wss://node.kron.technology",
    indexerUrl: "https://kascov.io",
    daaScore: null,
    synced: false,
    tokenTotal: null,
    lastSync: null,
    dataSource: "offline",
    kasUsd: null,
    priceSource: null,
    priceUpdatedAt: null,
    tipDaa: null,
    activeCovenants: null,
    moves24h: null,
    births24h: null,
    burns24h: null,
    valueBorn24h: null,
    activity: [],
  },
  loading: true,
  error: null,
}

let state: Store = initialState
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let refreshing = false
let pollMs = 15_000

function emit() {
  for (const l of listeners) l()
}

/* ---------------------------------------------------------------------------
 * KRON registry lookup: covenant_id -> {tick, decimals, name}
 * ------------------------------------------------------------------------- */

let registryMap: Map<string, { tick: string; decimals: number; name: string }> | null = null

async function loadRegistryMap(): Promise<Map<string, { tick: string; decimals: number; name: string }>> {
  if (registryMap) return registryMap
  const map = new Map<string, { tick: string; decimals: number; name: string }>()
  try {
    const { discoverTokens } = await import("../utils/kcc20")
    const list = await discoverTokens()
    for (const t of list) {
      if (t.covenantId) map.set(t.covenantId.toLowerCase(), { tick: t.tick, decimals: t.decimals, name: t.name })
    }
  } catch {
    /* registry unreachable — fall back to kascov names */
  }
  registryMap = map
  return map
}

function resolveTick(reg: Map<string, { tick: string; decimals: number; name: string }>, m: KascovMarket): { tick: string; dec: number; name: string } {
  const hit = reg.get(m.token.covenantId.toLowerCase())
  if (hit) return { tick: hit.tick, dec: hit.decimals, name: hit.name }
  const name = m.token.name || "anon"
  const words = name.split("-").filter(Boolean)
  const tick = words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() : name.slice(0, 6).toUpperCase()
  return { tick, dec: 8, name }
}

/* ---------------------------------------------------------------------------
 * KasCov refresh path
 * ------------------------------------------------------------------------- */

async function refreshFromKascov(reg: Map<string, { tick: string; decimals: number; name: string }>): Promise<Store> {
  const [price, live, digest, activity, curveRows, poolRows, trades] = await Promise.all([
    fetchKasPrice(),
    fetchLive(),
    fetchDigest(),
    fetchActivity("24h"),
    fetchMarkets({ phase: "bonding", limit: 100 }).catch(() => []),
    fetchPools(100).catch(() => []),
    fetchTrades({ limit: 40 }).catch(() => []),
  ])
  const kasUsd = price.kasUsd
  const markets = [...poolRows, ...curveRows]
  const seen = new Set<string>()
  const rows: KascovMarket[] = []
  for (const m of markets) {
    const key = m.token.covenantId
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(m)
  }

  // Sparklines for the top reserves (market detail carries recent_trades).
  const top = [...rows].sort((a, b) => b.reserveSompi - a.reserveSompi).slice(0, 6)
  const sparkByCovid = new Map<string, number[]>()
  const details = await Promise.all(
    top.map((m) => fetchMarket(m.marketId).catch(() => null)),
  )
  for (let i = 0; i < top.length; i++) {
    const d = details[i]
    if (d) sparkByCovid.set(top[i].token.covenantId, sparklineFromTrades(d.recentTrades))
  }

  const now = Date.now()
  const tokens: Kcc20Token[] = []
  const pools: LivePool[] = []

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i]
    const resolved = resolveTick(reg, m)
    const priceKas = marketSpotKas(m)
    const priceUsd = marketSpotUsd(m, kasUsd)
    const reserveKas = marketReserveKas(m)
    const volUsd = marketVolumeUsd(m, kasUsd)
    const mcapUsd = marketMcUsd(m, kasUsd)
    const changeBps = m.change24hBps ?? 0
    const changePct = changeBps / 100
    const trades24h = m.trades24h ?? 0
    const tvlUsd = reserveKas * kasUsd + (m.program.tokenReserve ?? 0) * priceUsd
    const aprRaw = Math.min(
      240,
      (volUsd > 0 && tvlUsd > 0 ? ((volUsd * 0.003) / tvlUsd) * 365 * 100 : 0) + (m.phase === "graduated" ? 4 : 12),
    )
    const spark = sparkByCovid.get(m.token.covenantId) ?? []
    const lastPriceUsd = marketLastPriceUsd(m, kasUsd)

    pools.push({
      id: pools.length + 1,
      pair: `${resolved.tick} / KAS`,
      tvl: `$${fmtCompact(tvlUsd)}`,
      tvlUsd,
      vol: `$${fmtCompact(volUsd)}`,
      volUsd,
      apr: `${aprRaw.toFixed(1)}%`,
      aprRaw,
      data: spark.length ? spark : (priceKas > 0 ? [priceKas, priceKas] : [0.0001, 0.0001]),
      tick: resolved.tick,
      graduated: m.phase === "graduated",
      kasReserve: reserveKas,
      tokenReserve: m.program.tokenReserve ?? m.spotDen,
      price: priceKas,
      priceUsd,
      change24h: changeBps,
      changePct,
      covenantId: m.token.covenantId,
      trades24h,
      holders: m.token.holders,
      mcapUsd,
      gradProgress: (m.gradProgressBps ?? 0) / 100,
      lastSide: m.lastSide,
      lastTimeMs: m.lastTimeMs,
    })

    tokens.push({
      tick: resolved.tick,
      name: resolved.name,
      decimals: resolved.dec,
      covenantId: m.token.covenantId,
      curveCovenantId: m.program.covenantId,
      poolCovenantId: m.phase === "graduated" ? m.program.covenantId : null,
      graduated: m.phase === "graduated",
      price: priceUsd,
      change24h: changePct,
      volume24h: volUsd,
      volumeTotal: 0,
      trades24h,
      cpState: {
        realKas: reserveKas,
        tokenReserve: m.program.tokenReserve ?? 0,
        graduated: m.phase === "graduated",
        ...(m.phase === "graduated" ? { poolKas: reserveKas, poolTokenReserve: m.program.tokenReserve ?? 0 } : {}),
      },
      curveParams: null,
      reserveKas: String(m.reserveSompi),
      tokenReserve: String(m.program.tokenReserve ?? 0),
      toTokenInfo: () => ({
        ticker: resolved.tick,
        name: resolved.name,
        decimals: resolved.dec,
        icon: resolved.tick[0],
        isKrc20: true,
        address: m.token.covenantId,
      }),
    } as Kcc20Token)
  }

  pools.sort((a, b) => b.tvlUsd - a.tvlUsd)
  tokens.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))

  const tickByCovid = new Map<string, { tick: string; dec: number }>()
  for (const t of tokens) tickByCovid.set(t.covenantId.toLowerCase(), { tick: t.tick, dec: t.decimals })

  const trades24hMoves = digest.moves
  const mapped: LiveTrade[] = trades.slice(0, 30).map((t, i) => {
    const res = tickByCovid.get(t.tokenId.toLowerCase())
    const tick = res?.tick ?? t.tokenId.slice(0, 6).toUpperCase()
    const priceUsd = t.baseAmount > 0 && t.quoteSompi > 0 ? (t.quoteSompi / 100_000_000) * kasUsd / t.baseAmount : 0
    return {
      id: i + 1,
      kind: t.side === "sell" ? ("Sell" as const) : ("Buy" as const),
      amount: `${fmtCompact(t.baseAmount)} ${tick}`,
      price: `$${priceUsd > 0 ? priceUsd.toFixed(6) : "—"}`,
      when: t.acceptingTimeMs ? `${Math.max(1, Math.round(now / 1000 - t.acceptingTimeMs / 1000))}s` : "—",
      tick,
      txid: t.txid,
      baseAmount: t.baseAmount,
      priceUsd,
    }
  })

  return {
    tokens,
    pools,
    trades: mapped,
    info: {
      direct: true,
      rpcUrl: "wss://node.kron.technology",
      indexerUrl: "https://kascov.io",
      daaScore: live.processedDaa,
      synced: true,
      tokenTotal: tokens.length,
      lastSync: now,
      dataSource: "kascov",
      kasUsd,
      priceSource: price.source,
      priceUpdatedAt: price.updatedAtMs,
      tipDaa: digest.tipDaa,
      activeCovenants: digest.activeNow,
      moves24h: trades24hMoves,
      births24h: digest.births,
      burns24h: digest.burns,
      valueBorn24h: digest.valueBornSompi / 100_000_000,
      activity,
    },
    loading: false,
    error: null,
  }
}

/* ---------------------------------------------------------------------------
 * KRON indexer fallback path (previous implementation, kept as fallback)
 * ------------------------------------------------------------------------- */

interface MarketRow {
  tick: string
  name?: string
  dec: number
  graduated: boolean
  covenantId: string
  price?: number
  change24h?: number
  volume24h?: number
  tvl?: number
  reserveKas?: string
  tokenReserve?: string
  sparkline?: number[]
}

interface TradeRow {
  txid?: string
  ts?: number
  side?: string
  kind?: string
  price?: number
  volume?: number
  amount?: number
  tick?: string
}

async function kronMarketList(): Promise<MarketRow[]> {
  const idx = indexer()
  const [curves, pools] = await Promise.all([
    idx.markets({ kind: "curve" }).catch(() => []),
    idx.markets({ kind: "pool" }).catch(() => []),
  ])
  const seen = new Set<string>()
  const merged: MarketRow[] = []
  for (const row of [...pools, ...curves]) {
    if (seen.has(row.tick)) continue
    seen.add(row.tick)
    merged.push(row as MarketRow)
  }
  return merged
}

async function kronRecentTrades(): Promise<TradeRow[]> {
  const idx = indexer()
  const mk = await kronMarketList().catch(() => [])
  const targets = mk.length ? mk.slice(0, 4) : []
  const results = await Promise.all(
    targets.map((t) => idx.trades(t.tick.toLowerCase(), { limit: 6 }).catch(() => [])),
  )
  const out: TradeRow[] = []
  for (let i = 0; i < results.length; i++) {
    for (const r of results[i] ?? []) out.push({ ...(r as TradeRow), tick: targets[i]?.tick })
  }
  out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  return out.slice(0, 14)
}

async function refreshFromKron(prev: L1StateInfo): Promise<Store> {
  const idx = indexer()
  const [infoRes, markets, tape, live, digest, activity, price] = await Promise.all([
    idx.info().catch(() => null),
    kronMarketList(),
    kronRecentTrades(),
    fetchLive().catch(() => null),
    fetchDigest().catch(() => null),
    fetchActivity("24h").catch(() => []),
    fetchKasPrice().catch(() => null),
  ])
  const now = Date.now()
  const seen: Kcc20Token[] = []
  const poolRows: LivePool[] = []
  for (const row of markets) {
    const priceKas = row.price ?? 0
    const reserveKas = Number(row.reserveKas ?? 0) / 100_000_000
    const kasUsd = price?.kasUsd ?? prev.kasUsd ?? 0
    const tvlUsd = row.tvl ?? reserveKas + Number(row.tokenReserve ?? 0) * priceKas * kasUsd
    const volUsd = row.volume24h ?? 0
    const aprRaw = Math.min(240, (volUsd > 0 && tvlUsd > 0 ? ((volUsd * 0.003) / tvlUsd) * 365 * 100 : 0) + (row.graduated ? 4 : 12))
    poolRows.push({
      id: poolRows.length + 1,
      pair: `${row.tick.toUpperCase()} / KAS`,
      tvl: `$${fmtCompact(tvlUsd)}`,
      tvlUsd,
      vol: `$${fmtCompact(volUsd)}`,
      volUsd,
      apr: `${aprRaw.toFixed(1)}%`,
      aprRaw,
      data: (row.sparkline ?? []).slice(-12),
      tick: row.tick,
      graduated: row.graduated,
      kasReserve: reserveKas,
      tokenReserve: Number(row.tokenReserve ?? 0),
      price: priceKas,
      priceUsd: priceKas * kasUsd,
      change24h: row.change24h ?? 0,
      changePct: (row.change24h ?? 0) / 100,
      covenantId: row.covenantId,
      trades24h: 0,
      holders: 0,
      mcapUsd: 0,
      gradProgress: row.graduated ? 100 : 0,
    })
    seen.push({
      tick: row.tick,
      name: row.name ?? row.tick.toUpperCase(),
      decimals: row.dec,
      covenantId: row.covenantId,
      curveCovenantId: "",
      poolCovenantId: row.graduated ? row.covenantId : null,
      graduated: row.graduated,
      price: priceKas * kasUsd,
      change24h: row.change24h,
      volume24h: volUsd,
      volumeTotal: 0,
      trades24h: 0,
      cpState: {
        realKas: reserveKas,
        tokenReserve: Number(row.tokenReserve ?? 0),
        graduated: row.graduated,
        ...(row.graduated ? { poolKas: reserveKas, poolTokenReserve: Number(row.tokenReserve ?? 0) } : {}),
      },
      curveParams: null,
      reserveKas: row.reserveKas,
      tokenReserve: row.tokenReserve ?? "0",
      toTokenInfo: () => ({
        ticker: row.tick,
        name: row.tick.toUpperCase(),
        decimals: row.dec,
        icon: "K",
        isKrc20: true,
        address: row.covenantId,
      }),
    } as Kcc20Token)
  }
  poolRows.sort((a, b) => b.tvlUsd - a.tvlUsd)

  const mapped: LiveTrade[] = tape.map((t, i) => ({
    id: i + 1,
    kind: String(t.side ?? "buy").toLowerCase() === "sell" ? ("Sell" as const) : ("Buy" as const),
    amount: `${fmtCompact(Number(t.volume ?? t.amount ?? 0))} KAS`,
    price: `$${(t.price ?? 0).toFixed(4)}`,
    when: t.ts ? `${Math.max(1, Math.round(now / 1000 - t.ts))}s` : "—",
    tick: t.tick ?? "",
    txid: t.txid ?? "",
    baseAmount: Number(t.amount ?? 0),
    priceUsd: t.price ?? 0,
  }))

  return {
    tokens: seen,
    pools: poolRows,
    trades: mapped,
    info: {
      ...prev,
      direct: true,
      daaScore: infoRes?.daaScore ?? live?.processedDaa ?? prev.daaScore,
      synced: infoRes?.synced ?? prev.synced,
      tokenTotal: infoRes?.tokenTotal ?? prev.tokenTotal,
      lastSync: now,
      dataSource: "kron",
      kasUsd: price?.kasUsd ?? prev.kasUsd,
      priceSource: price?.source ?? prev.priceSource,
      priceUpdatedAt: price?.updatedAtMs ?? prev.priceUpdatedAt,
      tipDaa: digest?.tipDaa ?? prev.tipDaa,
      activeCovenants: digest?.activeNow ?? prev.activeCovenants,
      moves24h: digest?.moves ?? prev.moves24h,
      births24h: digest?.births ?? prev.births24h,
      burns24h: digest?.burns ?? prev.burns24h,
      valueBorn24h: digest ? digest.valueBornSompi / 100_000_000 : prev.valueBorn24h,
      activity: activity.length ? activity : prev.activity,
    },
    loading: false,
    error: null,
  }
}

/* ---------------------------------------------------------------------------
 * Store lifecycle
 * ------------------------------------------------------------------------- */

async function refresh() {
  if (refreshing) return
  refreshing = true
  const prevInfo = state.info
  try {
    const reg = await loadRegistryMap()
    state = await refreshFromKascov(reg)
  } catch (kascovErr) {
    try {
      state = await refreshFromKron(prevInfo)
    } catch {
      state = { ...state, loading: false, error: kascovErr instanceof Error ? kascovErr.message : "L1 state read failed" }
    }
  } finally {
    refreshing = false
    emit()
  }
}

function start() {
  if (timer) return
  refresh()
  timer = setInterval(refresh, pollMs)
}

/* ---------------------------------------------------------------------------
 * Public hook — shared across components, one poller for the whole app
 * ------------------------------------------------------------------------- */

export function useKcc20State(_pollMs = 15_000) {
  const [snap, setSnap] = useState<Store>(state)

  useEffect(() => {
    start()
    const onChange = () => setSnap(state)
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }, [])

  const byTick = useMemo(() => {
    const m = new Map<string, Kcc20Token>()
    for (const t of snap.tokens) m.set(t.tick.toLowerCase(), t)
    return m
  }, [snap.tokens])

  const refreshNow = useCallback(() => {
    refresh()
  }, [])

  return { ...snap, byTick, refresh: refreshNow }
}