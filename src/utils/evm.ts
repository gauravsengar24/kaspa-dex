import { ethers, BrowserProvider, JsonRpcProvider, Contract } from "ethers"
import { KASPLEX_TESTNET_ADDRESSES } from "../types"
import type { ContractAddresses } from "../types"

const KASPLEX_RPC = "https://rpc.kasplextest.xyz"

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) view returns (address)",
  "function allPairsLength() view returns (uint256)",
  "function allPairs(uint256) view returns (address)",
]

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)",
  "function balanceOf(address) view returns (uint256)",
]

const ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] memory amounts)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] memory amounts)",
  "function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256)",
]

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]

export function getRpcProvider(): JsonRpcProvider {
  return new JsonRpcProvider(KASPLEX_RPC, 167012, { staticNetwork: true })
}

export async function getSignerProvider(): Promise<BrowserProvider> {
  const kasware = (window as any).kasware
  if (kasware?.ethereum) {
    return new BrowserProvider(kasware.ethereum, 167012)
  }
  if ((window as any).ethereum) {
    return new BrowserProvider((window as any).ethereum, 167012)
  }
  throw new Error("No EVM wallet found. Install KasWare or MetaMask.")
}

export function getFactoryContract(signerOrProvider?: ethers.Provider | ethers.Signer): Contract {
  return new Contract(KASPLEX_TESTNET_ADDRESSES.factory, FACTORY_ABI, signerOrProvider ?? getRpcProvider())
}

export function getPairContract(address: string, signerOrProvider?: ethers.Provider | ethers.Signer): Contract {
  return new Contract(address, PAIR_ABI, signerOrProvider ?? getRpcProvider())
}

export function getRouterContract(signerOrProvider?: ethers.Provider | ethers.Signer): Contract {
  return new Contract(KASPLEX_TESTNET_ADDRESSES.router, ROUTER_ABI, signerOrProvider ?? getRpcProvider())
}

export function getErc20Contract(address: string, signerOrProvider?: ethers.Provider | ethers.Signer): Contract {
  return new Contract(address, ERC20_ABI, signerOrProvider ?? getRpcProvider())
}

export interface OnChainPool {
  pairAddress: string
  token0: string
  token1: string
  reserve0: bigint
  reserve1: bigint
}

export async function fetchAllPools(provider?: ethers.Provider): Promise<OnChainPool[]> {
  const factory = getFactoryContract(provider ?? getRpcProvider())
  const length = await factory.allPairsLength()
  const pools: OnChainPool[] = []
  for (let i = 0; i < length; i++) {
    const pairAddress: string = await factory.allPairs(i)
    const pair = getPairContract(pairAddress, provider)
    const [token0, token1, reserves] = await Promise.all([
      pair.token0() as Promise<string>,
      pair.token1() as Promise<string>,
      pair.getReserves() as Promise<[bigint, bigint, number]>,
    ])
    pools.push({
      pairAddress,
      token0,
      token1,
      reserve0: reserves[0],
      reserve1: reserves[1],
    })
  }
  return pools
}

export async function fetchPairReserves(
  tokenA: string,
  tokenB: string,
  provider?: ethers.Provider
): Promise<{ reserve0: bigint; reserve1: bigint; pairAddress: string } | null> {
  const factory = getFactoryContract(provider ?? getRpcProvider())
  const pairAddress: string = await factory.getPair(tokenA, tokenB)
  if (pairAddress === ethers.ZeroAddress) return null
  const pair = getPairContract(pairAddress, provider)
  const reserves = await pair.getReserves() as [bigint, bigint, number]
  return { reserve0: reserves[0], reserve1: reserves[1], pairAddress }
}

export async function approveToken(
  tokenAddress: string,
  spender: string,
  amount: bigint
): Promise<ethers.TransactionResponse> {
  const provider = await getSignerProvider()
  const signer = await provider.getSigner()
  const token = getErc20Contract(tokenAddress, signer)
  return token.approve(spender, amount)
}

export async function executeSwap(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  deadline: number
): Promise<ethers.TransactionResponse> {
  const provider = await getSignerProvider()
  const signer = await provider.getSigner()
  const router = getRouterContract(signer)
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, await signer.getAddress(), deadline)
}

const WKAS_ABI = [
  "function deposit() payable",
  "function withdraw(uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]

export async function getTokenBalance(tokenAddress: string, owner: string): Promise<bigint> {
  const erc20 = getErc20Contract(tokenAddress)
  return erc20.balanceOf(owner) as Promise<bigint>
}

export async function getProviderAddress(): Promise<string> {
  const provider = await getSignerProvider()
  const signer = await provider.getSigner()
  return signer.getAddress()
}

export async function wrapKAS(amount: bigint): Promise<ethers.TransactionResponse> {
  const provider = await getSignerProvider()
  const signer = await provider.getSigner()
  const wkas = new ethers.Contract(KASPLEX_TESTNET_ADDRESSES.wkas, WKAS_ABI, signer)
  return wkas.deposit({ value: amount })
}

export async function unwrapWKAS(amount: bigint): Promise<ethers.TransactionResponse> {
  const provider = await getSignerProvider()
  const signer = await provider.getSigner()
  const wkas = new ethers.Contract(KASPLEX_TESTNET_ADDRESSES.wkas, WKAS_ABI, signer)
  return wkas.withdraw(amount)
}

const WEIGHTED_POOL_ABI = [
  "function getTokens() view returns (address[])",
  "function getNormalizedWeights() view returns (uint256[])",
  "function getSwapFee() view returns (uint256)",
  "function getInvariant() view returns (uint256)",
  "function getTotalSupply() view returns (uint256)",
  "function getBalance(address) view returns (uint256)",
  "function onSwap(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)",
  "function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) returns (uint256)",
]

const MODULE_A_VAULT_ABI = [
  "function batchSwap(tuple(address pool, address tokenIn, address tokenOut)[] steps, uint256 amountIn, uint256 minAmountOut, uint256 deadline) returns (uint256)",
  "function queryBatchSwap(tuple(address pool, address tokenIn, address tokenOut)[] steps, uint256 amountIn) view returns (uint256)",
  "function swapExactIn(address pool, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint256 deadline) returns (uint256)",
  "function swapExactInKAS(address pool, address tokenOut, uint256 minAmountOut, uint256 deadline) payable returns (uint256)",
  "function batchSwapKASIn(tuple(address pool, address tokenIn, address tokenOut)[] steps, uint256 minAmountOut, uint256 deadline) payable returns (uint256)",
  "function registeredPools(address) view returns (bool)",
  "function wkas() view returns (address)",
]

export function getWeightedPoolContract(
  address: string,
  signerOrProvider?: ethers.Provider | ethers.Signer
): Contract {
  return new Contract(address, WEIGHTED_POOL_ABI, signerOrProvider ?? getRpcProvider())
}

export function getModuleAVaultContract(
  vaultAddress: string,
  signerOrProvider?: ethers.Provider | ethers.Signer
): Contract {
  return new Contract(vaultAddress, MODULE_A_VAULT_ABI, signerOrProvider ?? getRpcProvider())
}

import { MODULE_A_ADDRESSES } from "../types"

export async function queryBatchSwap(
  steps: { pool: string; tokenIn: string; tokenOut: string }[],
  amountIn: bigint
): Promise<bigint> {
  const vault = getModuleAVaultContract(MODULE_A_ADDRESSES.vault, getRpcProvider())
  return vault.queryBatchSwap(steps, amountIn) as Promise<bigint>
}

export async function executeBatchSwap(
  steps: { pool: string; tokenIn: string; tokenOut: string }[],
  amountIn: bigint,
  minAmountOut: bigint,
  deadline: number
): Promise<ethers.TransactionResponse> {
  const provider = await getSignerProvider()
  const signer = await provider.getSigner()
  const vault = getModuleAVaultContract(MODULE_A_ADDRESSES.vault, signer)
  return vault.batchSwap(steps, amountIn, minAmountOut, deadline)
}

export async function executeBatchSwapKASIn(
  steps: { pool: string; tokenIn: string; tokenOut: string }[],
  minAmountOut: bigint,
  deadline: number,
  value: bigint
): Promise<ethers.TransactionResponse> {
  const provider = await getSignerProvider()
  const signer = await provider.getSigner()
  const vault = getModuleAVaultContract(MODULE_A_ADDRESSES.vault, signer)
  return vault.batchSwapKASIn(steps, minAmountOut, deadline, { value })
}

export { WEIGHTED_POOL_ABI, MODULE_A_VAULT_ABI }
