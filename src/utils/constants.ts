import type { TokenInfo } from "../types"
import { KASPLEX_TESTNET_ADDRESSES, TESTNET_TOKENS } from "../types"

export const KASPA_TOKEN: TokenInfo = {
  ticker: "KAS",
  name: "Kaspa",
  decimals: 18,
  icon: "⟠",
  address: KASPLEX_TESTNET_ADDRESSES.wkas,
  isKrc20: false,
}

export const TOKENS: TokenInfo[] = [
  KASPA_TOKEN,
  { ticker: "USDT", name: "Tether USD", decimals: 18, icon: "💵", address: TESTNET_TOKENS.USDT.address, isKrc20: false },
  { ticker: "NACHO", name: "Nacho Coin", decimals: 18, icon: "🌮", address: TESTNET_TOKENS.NACHO.address, isKrc20: false },
  { ticker: "KASPY", name: "Kaspy Token", decimals: 8, icon: "🐕", address: undefined, isKrc20: true },
  { ticker: "GHOST", name: "Ghost KAS", decimals: 8, icon: "👻", address: undefined, isKrc20: true },
  { ticker: "KASPER", name: "Kasper", decimals: 8, icon: "💎", address: undefined, isKrc20: true },
  { ticker: "PEPEK", name: "Pepes on KAS", decimals: 8, icon: "🐸", address: undefined, isKrc20: true },
  { ticker: "KISHU", name: "Kishu Inu", decimals: 8, icon: "🐶", address: undefined, isKrc20: true },
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
