import { useState, useEffect, useRef, useCallback } from "react"
import { ethers } from "ethers"
import { fetchAllPools, getTokenBalance, getRpcProvider } from "../utils/evm"
import { KASPLEX_TESTNET_ADDRESSES } from "../types"
import type { PoolInfo } from "../types"

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

      const tokenAddressToTicker: Record<string, string> = {
        [KASPLEX_TESTNET_ADDRESSES.wkas.toLowerCase()]: "KAS",
      }

      const mapped: PoolInfo[] = []
      for (const pool of onChain) {
        const t0 = tokenAddressToTicker[pool.token0.toLowerCase()] || pool.token0
        const t1 = tokenAddressToTicker[pool.token1.toLowerCase()] || pool.token1

        const wkas = KASPLEX_TESTNET_ADDRESSES.wkas.toLowerCase()
        const kasReserve = wkas === pool.token0.toLowerCase() ? pool.reserve0 : wkas === pool.token1.toLowerCase() ? pool.reserve1 : 0n

        const nativePrice = 0.02
        const tvl = Number(kasReserve) / 1e18 * nativePrice * 2

        mapped.push({
          id: pool.pairAddress,
          token0: t0,
          token1: t1,
          reserve0: ethers.formatEther(pool.reserve0),
          reserve1: ethers.formatEther(pool.reserve1),
          fee: 0.25,
          tvl,
          volume24h: tvl * 0.2,
          apr: 8 + Math.random() * 20,
        })
      }

      if (mountedRef.current) {
        setPools(mapped.length > 0 ? mapped : [])
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
