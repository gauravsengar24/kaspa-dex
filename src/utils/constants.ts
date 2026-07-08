import type { TokenInfo, PoolInfo } from "../types"

export const KASPA_TOKEN: TokenInfo = {
  ticker: "KAS",
  name: "Kaspa",
  decimals: 8,
  icon: "⟠",
  isKrc20: false,
}

export const TOKENS: TokenInfo[] = [
  KASPA_TOKEN,
  { ticker: "USDT", name: "Tether USD", decimals: 6, icon: "💵", isKrc20: true },
  { ticker: "NACHO", name: "Nacho Coin", decimals: 8, icon: "🌮", isKrc20: true },
  { ticker: "KASPY", name: "Kaspy Token", decimals: 8, icon: "🐕", isKrc20: true },
  { ticker: "GHOST", name: "Ghost KAS", decimals: 8, icon: "👻", isKrc20: true },
  { ticker: "KASPER", name: "Kasper", decimals: 8, icon: "💎", isKrc20: true },
  { ticker: "PEPEK", name: "Pepes on KAS", decimals: 8, icon: "🐸", isKrc20: true },
  { ticker: "KISHU", name: "Kishu Inu", decimals: 8, icon: "🐶", isKrc20: true },
]

export const POOLS: PoolInfo[] = [
  { id: "0", token0: "KAS", token1: "USDT", reserve0: "1000000", reserve1: "30000", fee: 0.05, tvl: 60000, volume24h: 250000, apr: 12.5 },
  { id: "1", token0: "KAS", token1: "NACHO", reserve0: "1250000", reserve1: "250000000", fee: 0.3, tvl: 75000, volume24h: 15000, apr: 24.5 },
  { id: "2", token0: "KAS", token1: "KASPY", reserve0: "850000", reserve1: "50000000", fee: 0.3, tvl: 51000, volume24h: 10000, apr: 18.2 },
  { id: "3", token0: "KAS", token1: "GHOST", reserve0: "320000", reserve1: "18000000", fee: 0.25, tvl: 19200, volume24h: 5000, apr: 32.1 },
  { id: "4", token0: "NACHO", token1: "KASPY", reserve0: "80000000", reserve1: "15000000", fee: 0.3, tvl: 4800, volume24h: 2000, apr: 8.7 },
]

export const NETWORK = {
  name: "Kaspa Testnet-12",
  rpc: "ws://testnet-12.kaspa.org:17210",
  wss: "wss://testnet-12.kaspa.org:17211",
  explorer: "https://explorer.kaspa.org/tx",
  backend: import.meta.env.VITE_API_URL || "http://localhost:8000",
}

export const SWAP_FEE_PERCENT = 0.3
export const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0]
export const DEFAULT_SLIPPAGE = 0.5
