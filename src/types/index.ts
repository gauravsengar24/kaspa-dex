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

export interface ContractAddresses {
  factory: string
  router: string
  bridgeAdapter: string
  wkas: string
  kurveBridge: string
  katBridge: string
}

export interface SkillDefinition {
  name: string
  description: string
  parameters: Record<string, any>
}

export interface BridgeTransfer {
  id: string
  direction: "deposit" | "withdraw"
  token: string
  amount: string
  kaspaAddress: string
  txHash?: string
  status: "pending" | "confirmed" | "failed"
  timestamp: number
}

export interface BridgeConfig {
  kurveBridge: string
  katBridge: string
  wkas: string
  chainId: number
  rpcUrl: string
  explorerUrl: string
  minDeposit: number
  bridgeAdapter?: string
}

export interface ModuleAPoolInfo {
  poolAddress: string
  tokens: { address: string; ticker: string; weight: number; balance: string }[]
  swapFee: number
  totalSupply: string
  tvl: number
}

export interface SwapStep {
  pool: string
  tokenIn: string
  tokenOut: string
}

export const KASPLEX_TESTNET_ADDRESSES: ContractAddresses = {
  factory: "0x86B1Fcd6f4e2095144fdEd4bAde33aC1Ef9fD132",
  router: "0x14163052f4AAd3a653b0cF8f0E4182A4F37B8edb",
  bridgeAdapter: "0x0B8A06fa0007B9e153a6F93982AB467d05bad445",
  wkas: "0xC065C62a10fB363fD31CA394D632C4Df106566df",
  kurveBridge: "0x34606E6d01280f49791628B311cF33A808d1f7C6",
  katBridge: "0x699e7f4a64f6A5a1d7E26B05806d948338E7aDC2",
}

export const TESTNET_TOKENS: Record<string, { address: string; decimals: number }> = {
  KAS: { address: KASPLEX_TESTNET_ADDRESSES.wkas, decimals: 18 },
  USDT: { address: "0xffe75a83620025ADa3742b19163D7E9BE2b2322f", decimals: 18 },
  NACHO: { address: "0x556fa22558Eaa84E7686E8eAbE7582930BB1b4DB", decimals: 18 },
  TUSD: { address: "0xE3ADCE18f646BF44c263319ABffB33b83F0B5A35", decimals: 18 },
}

export const STABLESWAP_POOL_ADDRESS = "0x9574FaE44Edc3A44269f2C5D668bB7f8f0AE6323"
export const LENDING_POOL_ADDRESS = "0x4C3fd76D5998aEc6F0B964B82EF0B834F7fCd04A"

export const MODULE_A_ADDRESSES = {
  factory: "0x1eA9faA1B1A533e85f6C41E7B70f4ea4a50836d6",
  vault: "0x05eba420e02749Ee1A7AECe8f2F3b4Db4d3C013C",
  wkas: "0xC065C62a10fB363fD31CA394D632C4Df106566df",
}

export interface BatchQuote {
  steps: SwapStep[]
  amountIn: string
  amountOut: string
  tokenIn: string
  tokenOut: string
}
