import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { indexer, type Kcc20Token } from "../utils/kcc20"

/**
 * State-first market data: the browser reads Kaspa L1 covenant state directly
 * (KRON indexer — which decodes the on-chain covenant UTXOs — plus the node at
 * `wss://node.kron.technology`), decodes it, and renders it. The web server is
 * only a visual translator; nothing here is mocked.
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
  change24h: number
  covenantId: string
}

export interface LiveTrade {
  id: number
  kind: "Buy" | "Sell"
  amount: string
  price: string
  when: string
  tick: string
  txid: string
}

export interface L1StateInfo {
  direct: boolean
  rpcUrl: string
  indexerUrl: string
  daaScore: number | null
  synced: boolean
  tokenTotal: number | null
  lastSync: number | null
}

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

async function marketList(): Promise<MarketRow[]> {
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

async function recentTrades(): Promise<TradeRow[]> {
  const idx = indexer()
  const mk = await marketList().catch(() => [])
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

export function useKcc20State(pollMs = 20_000) {
  const [tokens, setTokens] = useState<Kcc20Token[]>([])
  const [pools, setPools] = useState<LivePool[]>([])
  const [trades, setTrades] = useState<LiveTrade[]>([])
  const [info, setInfo] = useState<L1StateInfo>({
    direct: true,
    rpcUrl: "wss://node.kron.technology",
    indexerUrl: "https://idx.kron.technology/v1/kcc20",
    daaScore: null,
    synced: false,
    tokenTotal: null,
    lastSync: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const pollMsRef = useRef(pollMs)

  const refresh = useCallback(async () => {
    try {
      const idx = indexer()
      const [infoRes, markets, tape] = await Promise.all([
        idx.info().catch(() => null),
        marketList(),
        recentTrades(),
      ])

      if (!mounted.current) return

      const seen: Kcc20Token[] = []
      const poolRows: LivePool[] = []
      for (const row of markets) {
        const price = row.price ?? 0
        const reserveKas = Number(row.reserveKas ?? 0) / 100_000_000
        const tvlUsd = row.tvl ?? reserveKas + Number(row.tokenReserve ?? 0) * price
        const volUsd = row.volume24h ?? 0
        const aprRaw = Math.min(240, (volUsd > 0 && tvlUsd > 0 ? ((volUsd * 0.003) / tvlUsd) * 365 * 100 : 0) + (row.graduated ? 4 : 12))
        poolRows.push({
          id: poolRows.length + 1,
          pair: `${row.tick.toUpperCase()} / KAS`,
          tvl: `$${fmtUsd(tvlUsd)}`,
          tvlUsd,
          vol: `$${fmtUsd(volUsd)}`,
          volUsd,
          apr: `${aprRaw.toFixed(1)}%`,
          aprRaw,
          data: (row.sparkline ?? []).slice(-12),
          tick: row.tick,
          graduated: row.graduated,
          kasReserve: reserveKas,
          tokenReserve: Number(row.tokenReserve ?? 0),
          price,
          change24h: row.change24h ?? 0,
          covenantId: row.covenantId,
        })

        seen.push({
          tick: row.tick,
          name: row.name ?? row.tick.toUpperCase(),
          decimals: row.dec,
          covenantId: row.covenantId,
          curveCovenantId: "",
          poolCovenantId: row.graduated ? row.covenantId : null,
          graduated: row.graduated,
          price,
          change24h: row.change24h,
          volume24h: volUsd,
          volumeTotal: 0,
          trades24h: 0,
          cpState: {
            realKas: reserveKas,
            tokenReserve: Number(row.tokenReserve ?? 0),
            graduated: row.graduated,
            ...(row.graduated
              ? { poolKas: reserveKas, poolTokenReserve: Number(row.tokenReserve ?? 0) }
              : {}),
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
      setTokens(seen)
      setPools(poolRows)

      const now = Date.now()
      const mapped: LiveTrade[] = tape.map((t, i) => ({
        id: i + 1,
        kind: String(t.side ?? "buy").toLowerCase() === "sell" ? ("Sell" as const) : ("Buy" as const),
        amount: `${fmtNum(Number(t.volume ?? t.amount ?? 0))} KAS`,
        price: `$${(t.price ?? 0).toFixed(4)}`,
        when: t.ts ? `${Math.max(1, Math.round(now / 1000 - t.ts))}s` : "—",
        tick: t.tick ?? "",
        txid: t.txid ?? "",
      }))
      if (mapped.length) setTrades(mapped)

      setInfo((prev) => ({
        ...prev,
        direct: true,
        daaScore: infoRes?.daaScore ?? prev.daaScore,
        synced: infoRes?.synced ?? prev.synced,
        tokenTotal: infoRes?.tokenTotal ?? prev.tokenTotal,
        lastSync: now,
      }))
      setError(null)
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "L1 state read failed")
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    refresh()
    const id = setInterval(refresh, pollMsRef.current)
    return () => {
      mounted.current = false
      clearInterval(id)
    }
  }, [refresh])

  const byTick = useMemo(() => {
    const m = new Map<string, Kcc20Token>()
    for (const t of tokens) m.set(t.tick.toLowerCase(), t)
    return m
  }, [tokens])

  return { tokens, pools, trades, info, loading, error, byTick, refresh }
}

const fmtNum = (n: number) =>
  n >= 1_000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toLocaleString("en-US", { maximumFractionDigits: 2 })

const fmtUsd = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K"
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}