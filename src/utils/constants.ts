import type { TokenInfo } from "../types"

export const KASPA_TOKEN: TokenInfo = {
  ticker: "KAS",
  name: "Kaspa",
  decimals: 8,
  icon: "⟠",
  address: undefined,
  isKrc20: false,
}

export const TOKENS: TokenInfo[] = [
  KASPA_TOKEN,
  { ticker: "USDT", name: "Tether USD", decimals: 8, icon: "₮", address: undefined, isKrc20: true },
  { ticker: "NACHO", name: "Nacho Coin", decimals: 8, icon: "🌮", address: undefined, isKrc20: true },
  { ticker: "KASPER", name: "Kasper", decimals: 8, icon: "💎", address: undefined, isKrc20: true },
  { ticker: "PEPEK", name: "Pepes on KAS", decimals: 8, icon: "🐸", address: undefined, isKrc20: true },
  { ticker: "KISHU", name: "Kishu Inu", decimals: 8, icon: "🐶", address: undefined, isKrc20: true },
  { ticker: "GHOST", name: "Ghost KAS", decimals: 8, icon: "👻", address: undefined, isKrc20: true },
  { ticker: "KASPY", name: "Kaspy Token", decimals: 8, icon: "🐕", address: undefined, isKrc20: true },
]

export const NETWORK = {
  name: "Kaspa Mainnet",
  rpc: "wss://ws.kaspa.org",
  wss: "wss://ws.kaspa.org:18110",
  rest: "https://api.kaspa.org",
  kasplex: "https://api.kasplex.org/v1",
  explorer: "https://explorer.kaspa.org",
  backend: import.meta.env.VITE_API_URL || "",
}

export const SWAP_FEE_PERCENT = 0.3
export const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0]
export const DEFAULT_SLIPPAGE = 0.5
