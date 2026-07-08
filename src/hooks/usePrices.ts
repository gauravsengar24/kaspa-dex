import { useState, useEffect, useRef, useCallback } from "react"
import { NETWORK } from "../utils/constants"

export interface PriceData {
  kas: { usd: number; change24h: number }
  tokens: Record<string, { kas: number; usd: number }>
  updated: number
}

const defaultPrices: PriceData = {
  kas: { usd: 0, change24h: 0 },
  tokens: {},
  updated: 0,
}

export function usePrices(pollMs = 30_000) {
  const [prices, setPrices] = useState<PriceData>(defaultPrices)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPrices = useCallback(async (force = false) => {
    try {
      const url = force
        ? `${NETWORK.backend}/api/prices/refresh`
        : `${NETWORK.backend}/api/prices`
      const res = await fetch(url)
      if (res.ok) {
        const data: PriceData = await res.json()
        if (mountedRef.current) {
          setPrices(data)
          setLoading(false)
        }
      }
    } catch {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrices()
    const interval = setInterval(() => fetchPrices(), pollMs)
    return () => clearInterval(interval)
  }, [fetchPrices, pollMs])

  const tokenPrice = useCallback(
    (ticker: string): { kas: number; usd: number } => {
      if (ticker === "KAS") {
        return { kas: 1, usd: prices.kas.usd }
      }
      return (
        prices.tokens[ticker] || { kas: 0, usd: 0 }
      )
    },
    [prices]
  )

  const convert = useCallback(
    (amount: number, from: string, to: string): number => {
      const f = tokenPrice(from)
      const t = tokenPrice(to)
      if (f.kas === 0 || t.kas === 0) return 0
      return (amount * f.kas) / t.kas
    },
    [tokenPrice]
  )

  return { prices, loading, tokenPrice, convert, refresh: () => fetchPrices(true) }
}
