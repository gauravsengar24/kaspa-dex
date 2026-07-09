import { useState, useEffect, useRef, useCallback } from "react"
import { ethers } from "ethers"
import { getRpcProvider, getWeightedPoolContract } from "../utils/evm"
import { MODULE_A_ADDRESSES, TESTNET_TOKENS } from "../types"
import type { ModuleAPoolInfo } from "../types"

const MODULE_A_POOLS = [
  {
    poolAddress: "0x8922C983aD0f5374B17FD60a1dd6B4c51F44379A",
    tokens: ["WKAS", "USDC", "LINK"],
    weights: [0.4, 0.4, 0.2],
    label: "Multi-Asset 40/40/20",
  },
  {
    poolAddress: "0x8B98B56B8208C65e5659C2cA9037306eb0e6Acd1",
    tokens: ["WKAS", "WBTC"],
    weights: [0.7, 0.3],
    label: "Weighted 70/30",
  },
]

const TOKEN_TICKER_MAP: Record<string, string> = {
  "0xC065C62a10fB363fD31CA394D632C4Df106566df": "WKAS",
  "0x1d5c117398cf5fcC4FeFF180c0867ac150eBD8bD": "USDC",
  "0x74b768D3E4DC62AEBfa5d95ce55E62aeD33033ea": "LINK",
  "0xc5D68fbb18071C4a3c553d2f832715b66462387A": "WBTC",
}

export function useModuleAPools(pollMs = 30_000) {
  const [pools, setPools] = useState<ModuleAPoolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPools = useCallback(async () => {
    try {
      const provider = getRpcProvider()
      const result: ModuleAPoolInfo[] = []

      for (const cfg of MODULE_A_POOLS) {
        const pool = getWeightedPoolContract(cfg.poolAddress, provider)
        let tokens: string[] = []
        let weights: string[] = []
        let swapFee = 0n
        let totalSupply = 0n

        try {
          tokens = await pool.getTokens() as string[]
          weights = await pool.getNormalizedWeights() as string[]
          swapFee = await pool.getSwapFee() as bigint
          totalSupply = await pool.getTotalSupply() as bigint
        } catch {
          continue
        }

        const poolTokens: ModuleAPoolInfo["tokens"] = []
        let tvl = 0

        for (let i = 0; i < tokens.length; i++) {
          const rawAddr = tokens[i].toLowerCase()
          let balance = 0n
          try {
            balance = await pool.getBalance(tokens[i]) as bigint
          } catch {}
          const ticker = TOKEN_TICKER_MAP[rawAddr] || rawAddr.slice(0, 6)
          const weight = Number(weights[i]) / 1e18
          const balFormatted = ethers.formatEther(balance)
          const usdPrice = 0.02
          tvl += Number(balFormatted) * usdPrice
          poolTokens.push({
            address: rawAddr,
            ticker,
            weight,
            balance: balFormatted,
          })
        }

        result.push({
          poolAddress: cfg.poolAddress,
          tokens: poolTokens,
          swapFee: Number(swapFee) / 1e18,
          totalSupply: ethers.formatEther(totalSupply),
          tvl,
        })
      }

      if (mountedRef.current) {
        setPools(result)
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
