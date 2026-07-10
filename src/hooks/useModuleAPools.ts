import { useState, useEffect, useRef, useCallback } from "react"
import { ethers } from "ethers"
import { getRpcProvider, getWeightedPoolContract, getStableSwapPoolContract } from "../utils/evm"
import { MODULE_A_ADDRESSES, STABLESWAP_POOL_ADDRESS, TESTNET_TOKENS } from "../types"
import type { ModuleAPoolInfo } from "../types"

const MODULE_A_POOLS = [
  {
    poolAddress: "0xce6055f1b1d644C3846446538c48c446a9711e4f",
    tokens: ["WKAS", "USDC", "LINK"],
    weights: [0.4, 0.4, 0.2],
    label: "Multi-Asset 40/40/20",
    poolType: "weighted" as const,
  },
  {
    poolAddress: "0x72705552E3e5106B83c532Af9719d151B1eaE02E",
    tokens: ["WKAS", "WBTC"],
    weights: [0.7, 0.3],
    label: "Weighted 70/30",
    poolType: "weighted" as const,
  },
  {
    poolAddress: STABLESWAP_POOL_ADDRESS,
    tokens: ["USDC", "TUSD"],
    weights: [0.5, 0.5],
    label: "StableSwap USDC/TUSD",
    poolType: "stable" as const,
  },
]

const TOKEN_TICKER_MAP: Record<string, string> = {
  "0xC065C62a10fB363fD31CA394D632C4Df106566df": "WKAS",
  "0xB0c9d7e1e5635a1FBFfC8CFD75CE16BA1ccf2849": "USDC",
  "0xa2E3e66262825cA2C6a7352d4F5a1Ba9E82Ff89c": "LINK",
  "0x42134d776638D67e24cFA0d316f58B5e52cF885f": "WBTC",
  "0xE3ADCE18f646BF44c263319ABffB33b83F0B5A35": "TUSD",
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
        if (cfg.poolType === "stable") {
          const pool = getStableSwapPoolContract(cfg.poolAddress, provider)
          let totalSupply = 0n
          try {
            totalSupply = await pool.totalSupply() as bigint
          } catch { continue }

          const balancesRaw = await pool.getBalances() as bigint[]
          const poolTokens: ModuleAPoolInfo["tokens"] = []
          let tvl = 0

          for (let i = 0; i < balancesRaw.length; i++) {
            const coinAddr = await pool.coins(i) as string
            const rawAddr = coinAddr.toLowerCase()
            const ticker = TOKEN_TICKER_MAP[rawAddr] || cfg.tokens[i]
            const balFormatted = ethers.formatEther(balancesRaw[i])
            const usdPrice = 0.02
            tvl += Number(balFormatted) * usdPrice
            poolTokens.push({
              address: rawAddr,
              ticker,
              weight: cfg.weights[i],
              balance: balFormatted,
            })
          }

          result.push({
            poolAddress: cfg.poolAddress,
            tokens: poolTokens,
            swapFee: 0.0004,
            totalSupply: ethers.formatEther(totalSupply),
            tvl,
          })
        } else {
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
