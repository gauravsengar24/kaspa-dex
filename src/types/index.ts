export interface TokenInfo {
  ticker: string
  name: string
  decimals: number
  icon: string
  address?: string
  isKrc20?: boolean
}

export interface SwapQuote {
  fromToken: TokenInfo
  toToken: TokenInfo
  fromAmount: string
  toAmount: string
  price: string
  priceImpact: number
  fee: string
  feeUsd: string
  minReceived: string
  route: string[]
  expiry: number
}

export interface OrderbookEntry {
  id: string
  makerAddress: string
  makerAmount: number
  makerToken: string
  takerAmount: number
  takerToken: string
  timestamp: number
  status: "open" | "filling" | "completed" | "cancelled"
}

export interface Transaction {
  id: string
  type: "swap" | "addLiquidity" | "removeLiquidity"
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string
  timestamp: number
  status: "pending" | "confirmed" | "failed"
  txHash?: string
}

export interface PoolInfo {
  id: string
  token0: string
  token1: string
  reserve0: string
  reserve1: string
  fee: number
  tvl: number
  volume24h: number
  apr: number
}

export interface WalletState {
  address: string
  balance: number
  connected: boolean
  connecting: boolean
}

export interface LendingMarket {
  id: string
  token: string
  total_supply: number
  total_borrow: number
  total_reserves: number
  ltv: number
  liquidation_threshold: number
  utilization: number
  supply_apr: number
  borrow_apr: number
  is_collateral_enabled: boolean
  is_borrow_enabled: boolean
}

export interface YieldVault {
  id: string
  name: string
  token: string
  total_assets: number
  total_supply: number
  deposit_limit: number
  price_per_share: number
  apy: number
}

export interface PredictionRound {
  round_number: number
  lock_price: number | null
  result_price: number | null
  result_direction: string | null
  total_bets: number
  settled: boolean
}

export interface GovernanceProposal {
  id: string
  title: string
  description: string
  proposer: string
  status: string
  for_votes: number
  against_votes: number
  abstain_votes: number
  created_at: number
  end_time: number
}

export interface GaugeInfo {
  id: string
  name: string
  pool_type: string
  relative_weight: number
}

export interface IFOState {
  id: string
  token: string
  token_amount: number
  base_token: string
  state: string
  total_committed: number
  participants: number
}

export interface LBPState {
  id: string
  project_token: string
  base_token: string
  project_amount: number
  base_amount: number
  current_price: number
  state: string
}

export interface DutchAuctionState {
  id: string
  token: string
  token_amount: number
  base_token: string
  current_price: number
  start_price: number
  end_price: number
  state: string
}

export interface RouterQuote {
  token_in: string
  token_out: string
  amount_in: number
  amount_out: number
  route: { pool_id: string; type: string; amount_in: number; amount_out: number }[]
  error?: string
}

export interface UserProfile {
  address: string
  total_swaps: number
  total_volume: number
  liquidity_added: number
  achievements: string[]
  rank: string
  created_at: number
}

// EVM L2 contracts (for Kasplex zkEVM — not used on mainnet L1 DEX)
export interface ContractAddresses {
  factory: string
  router: string
  bridgeAdapter: string
  wkas: string
  kurveBridge: string
  katBridge: string
}
