import { useState, useEffect, useRef, useCallback } from "react"
import { ethers } from "ethers"
import { getRpcProvider } from "../utils/evm"
import { KASPLEX_TESTNET_ADDRESSES, TESTNET_POOLS, TESTNET_TOKENS } from "../types"
import type { PoolInfo } from "../types"

const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]

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
      const mapped: PoolInfo[] = []

      for (const p of TESTNET_POOLS) {
        const pair = new ethers.Contract(p.pair, PAIR_ABI, provider)
        let reserve0 = 0n, reserve1 = 0n
        try {
          const res = await pair.getReserves() as [bigint, bigint, number]
          reserve0 = res[0]
          reserve1 = res[1]
        } catch {}

        const kasReserve = p.token0 === "WKAS" ? reserve0 : p.token1 === "WKAS" ? reserve1 : 0n
        const nativePrice = 0.02
        const tvl = Number(kasReserve) / 1e18 * nativePrice * 2
        const tok0 = p.token0 === "WKAS" ? "KAS" : p.token0
        const tok1 = p.token1 === "WKAS" ? "KAS" : p.token1

        mapped.push({
          id: p.pair,
          token0: tok0,
          token1: tok1,
          reserve0: ethers.formatEther(reserve0),
          reserve1: ethers.formatEther(reserve1),
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
