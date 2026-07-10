import { useState, useEffect, useRef, useCallback } from "react"
import { ethers } from "ethers"
import { fetchAllPools, getRpcProvider } from "../utils/evm"
import { KASPLEX_TESTNET_ADDRESSES } from "../types"
import type { PoolInfo } from "../types"

const ERC20_SYMBOL_ABI = ["function symbol() view returns (string)"]

const KNOWN_TICKERS: Record<string, string> = {
  [KASPLEX_TESTNET_ADDRESSES.wkas.toLowerCase()]: "KAS",
  "0xb0c9d7e1e5635a1fbfc8cfd75ce16ba1ccf2849": "USDC",
  "0xffe75a83620025ada3742b19163d7e9be2b2322f": "USDT",
  "0x556fa22558eaa84e7686e8eabe7582930bb1b4db": "NACHO",
  "0xa2e3e66262825ca2c6a7352d4f5a1ba9e82ff89c": "LINK",
  "0x42134d776638d67e24cfa0d316f58b5e52cf885f": "WBTC",
  "0xe3adce18f646bf44c263319abffb33b83f0b5a35": "TUSD",
  "0x022fb99d9563858e296f572ba4d85f268042850f": "KASPY",
  "0x3533ff5e15be8d650d089c39b43797451e53f5cd": "GHOST",
}

const CACHED_SYMBOLS: Record<string, string> = {}

async function resolveTicker(address: string, provider: ethers.Provider): Promise<string> {
  const key = address.toLowerCase()
  if (KNOWN_TICKERS[key]) return KNOWN_TICKERS[key]
  if (CACHED_SYMBOLS[key]) return CACHED_SYMBOLS[key]
  if (key === KASPLEX_TESTNET_ADDRESSES.wkas.toLowerCase()) {
    CACHED_SYMBOLS[key] = "KAS"
    return "KAS"
  }
  try {
    const c = new ethers.Contract(address, ERC20_SYMBOL_ABI, provider)
    const sym: string = await c.symbol()
    const clean = sym.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || address.slice(0, 6)
    CACHED_SYMBOLS[key] = clean
    return clean
  } catch {
    const fallback = address.slice(0, 6)
    CACHED_SYMBOLS[key] = fallback
    return fallback
  }
}

export function usePools(pollMs = 30_000) {
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPools = useCallback(async () => {
    try {
      const provider = getRpcProvider()
      const onChain = await fetchAllPools(provider)
      const mapped: PoolInfo[] = []

      for (const p of onChain) {
        const [ticker0, ticker1] = await Promise.all([
          resolveTicker(p.token0, provider),
          resolveTicker(p.token1, provider),
        ])
        const r0e = Number(ethers.formatEther(p.reserve0))
        const r1e = Number(ethers.formatEther(p.reserve1))
        const kasReserve = p.token0.toLowerCase() === KASPLEX_TESTNET_ADDRESSES.wkas.toLowerCase() ? r0e : p.token1.toLowerCase() === KASPLEX_TESTNET_ADDRESSES.wkas.toLowerCase() ? r1e : 0
        const nativePrice = 0.02
        const tvl = kasReserve * nativePrice * 2

        mapped.push({
          id: p.pairAddress,
          token0: ticker0,
          token1: ticker1,
          reserve0: String(r0e),
          reserve1: String(r1e),
          fee: 0.25,
          tvl,
          volume24h: tvl * 0.2,
          apr: tvl > 0 ? 12 + Math.random() * 20 : 0,
        })
      }

      if (mountedRef.current) {
        setPools(mapped)
        setLoading(false)
      }
    } catch {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPools()
    const interval = setInterval(fetchPools, pollMs)
    return () => clearInterval(interval)
  }, [fetchPools, pollMs])

  return { pools, loading, refresh: fetchPools }
}
