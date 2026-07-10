import { ethers } from "ethers"
import { KASPLEX_TESTNET_ADDRESSES, MODULE_A_ADDRESSES, STABLESWAP_POOL_ADDRESS } from "../types"
import { getRpcProvider, getSignerProvider, getRouterContract, getWeightedPoolContract, getStableSwapPoolContract, getModuleAVaultContract, getErc20Contract } from "./evm"

const WKAS = KASPLEX_TESTNET_ADDRESSES.wkas.toLowerCase()

export interface RouteStep {
  poolType: "cpmm" | "weighted" | "stable"
  pool: string
  tokenIn: string
  tokenOut: string
  stableIndexIn?: number
  stableIndexOut?: number
}

export interface PoolsContext {
  cpmm: { pairAddress: string; token0: string; token1: string }[]
  weighted: { poolAddress: string; tokens: { ticker: string; address: string }[] }[]
  stable: { poolAddress: string; tokens: { ticker: string; address: string }[] }[]
}

const STABLE_COIN_INDEX: Record<string, number> = {
  "0xb0c9d7e1e5635a1fbfc8cfd75ce16ba1ccf2849": 0,
  "0xe3adce18f646bf44c263319abffb33b83f0b5a35": 1,
}

function getStableIndex(addr: string): number {
  return STABLE_COIN_INDEX[addr.toLowerCase()] ?? -1
}

export function findRoute(
  tickerIn: string,
  tickerOut: string,
  tokenAddrMap: Record<string, string>,
  ctx: PoolsContext
): RouteStep[] | null {
  if (tickerIn === tickerOut) return []
  const inAddr = tokenAddrMap[tickerIn]
  const outAddr = tokenAddrMap[tickerOut]
  if (!inAddr || !outAddr) return null

  const inKey = inAddr.toLowerCase()
  const outKey = outAddr.toLowerCase()

  // 1. Check StableSwap pool
  const stablePool = ctx.stable[0]
  if (stablePool) {
    const stableTokens = stablePool.tokens.map((t) => t.address.toLowerCase())
    if (stableTokens.includes(inKey) && stableTokens.includes(outKey)) {
      return [{
        poolType: "stable",
        pool: stablePool.poolAddress,
        tokenIn: inAddr,
        tokenOut: outAddr,
        stableIndexIn: getStableIndex(inAddr),
        stableIndexOut: getStableIndex(outAddr),
      }]
    }
  }

  // 2. Check CPMM direct pool
  const directCPMM = ctx.cpmm.find((p) => {
    const t0 = p.token0.toLowerCase(); const t1 = p.token1.toLowerCase()
    return (t0 === inKey && t1 === outKey) || (t0 === outKey && t1 === inKey)
  })
  if (directCPMM) return [{ poolType: "cpmm", pool: directCPMM.pairAddress, tokenIn: inAddr, tokenOut: outAddr }]

  // 3. Check Weighted direct pool
  const directWeighted = ctx.weighted.find((p) => {
    const addrs = p.tokens.map((t) => t.address.toLowerCase())
    return addrs.includes(inKey) && addrs.includes(outKey)
  })
  if (directWeighted) return [{ poolType: "weighted", pool: directWeighted.poolAddress, tokenIn: inAddr, tokenOut: outAddr }]

  // 4. Multi-hop via WKAS: CPMM × CPMM
  const inCPMM = ctx.cpmm.find((p) => p.token0.toLowerCase() === inKey || p.token1.toLowerCase() === inKey)
  const outCPMM = ctx.cpmm.find((p) => p.token0.toLowerCase() === outKey || p.token1.toLowerCase() === outKey)
  if (inCPMM && outCPMM) {
    const wk = WKAS
    const inToWk = inCPMM.token0.toLowerCase() === wk || inCPMM.token1.toLowerCase() === wk
    const outToWk = outCPMM.token0.toLowerCase() === wk || outCPMM.token1.toLowerCase() === wk
    if (inToWk && outToWk) {
      return [
        { poolType: "cpmm", pool: inCPMM.pairAddress, tokenIn: inAddr, tokenOut: WKAS },
        { poolType: "cpmm", pool: outCPMM.pairAddress, tokenIn: WKAS, tokenOut: outAddr },
      ]
    }
  }

  // 5. Multi-hop via WKAS: Weighted × Weighted
  const inWeighted = ctx.weighted.find((p) => p.tokens.some((t) => t.address.toLowerCase() === inKey))
  const outWeighted = ctx.weighted.find((p) => p.tokens.some((t) => t.address.toLowerCase() === outKey))
  if (inWeighted && outWeighted && inWeighted.poolAddress !== outWeighted.poolAddress) {
    return [
      { poolType: "weighted", pool: inWeighted.poolAddress, tokenIn: inAddr, tokenOut: WKAS },
      { poolType: "weighted", pool: outWeighted.poolAddress, tokenIn: WKAS, tokenOut: outAddr },
    ]
  }

  return null
}

export async function queryRoute(route: RouteStep[], amountIn: bigint): Promise<bigint | null> {
  const provider = getRpcProvider()
  const cpmmRouter = getRouterContract(provider)
  const vault = getModuleAVaultContract(MODULE_A_ADDRESSES.vault, provider)

  try {
    if (route.length === 1) {
      const step = route[0]
      if (step.poolType === "cpmm") {
        const amounts = await cpmmRouter.getAmountsOut(amountIn, [step.tokenIn, step.tokenOut]) as bigint[]
        return amounts[1]
      }
      if (step.poolType === "stable") {
        const pool = getStableSwapPoolContract(step.pool, provider)
        return pool.getDy(step.stableIndexIn!, step.stableIndexOut!, amountIn) as Promise<bigint>
      }
      if (step.poolType === "weighted") {
        const pool = getWeightedPoolContract(step.pool, provider)
        return pool.onSwap(step.tokenIn, step.tokenOut, amountIn) as Promise<bigint>
      }
    }
    if (route.length === 2) {
      if (route[0].poolType === "cpmm" && route[1].poolType === "cpmm") {
        const path = [route[0].tokenIn, route[0].tokenOut, route[1].tokenOut]
        const amounts = await cpmmRouter.getAmountsOut(amountIn, path) as bigint[]
        return amounts[2]
      }
      if (route[0].poolType === "weighted" && route[1].poolType === "weighted") {
        const steps = route.map((s) => ({ pool: s.pool, tokenIn: s.tokenIn, tokenOut: s.tokenOut }))
        return vault.queryBatchSwap(steps, amountIn) as Promise<bigint>
      }
    }
    return null
  } catch {
    return null
  }
}

const WKAS_CONTRACT_ABI = [
  "function deposit() payable",
  "function withdraw(uint256)",
  "function balanceOf(address) view returns (uint256)",
]

async function wrapNative(signer: ethers.Signer, amount: bigint): Promise<void> {
  const wkas = new ethers.Contract(WKAS, WKAS_CONTRACT_ABI, signer)
  const tx = await wkas.deposit({ value: amount })
  await tx.wait()
}

async function unwrapNative(signer: ethers.Signer, amount: bigint): Promise<void> {
  const wkas = new ethers.Contract(WKAS, WKAS_CONTRACT_ABI, signer)
  try {
    const tx = await wkas.withdraw(amount)
    await tx.wait()
  } catch { }
}

export async function executeRoute(
  route: RouteStep[],
  amountIn: bigint,
  minAmountOut: bigint,
  fromTokenTicker: string,
  toTokenTicker?: string
): Promise<ethers.ContractTransactionReceipt> {
  const provider = await getSignerProvider()
  const signer = await provider.getSigner()
  const userAddr = await signer.getAddress()
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20

  const isFromNative = fromTokenTicker === "KAS"
  const isToNative = toTokenTicker === "KAS"

  let receipt: ethers.ContractTransactionReceipt | null = null
  let outputToken: string | null = null

  if (route.length === 1) {
    const step = route[0]
    if (step.poolType === "cpmm") {
      const router = getRouterContract(signer)
      const path = isFromNative ? [WKAS, step.tokenOut] : [step.tokenIn, step.tokenOut]
      let actualFrom = step.tokenIn
      if (isFromNative) { await wrapNative(signer, amountIn); actualFrom = WKAS }
      if (actualFrom.toLowerCase() !== WKAS) {
        const atx = await (getErc20Contract(actualFrom, signer)).approve(KASPLEX_TESTNET_ADDRESSES.router, amountIn)
        await atx.wait()
      }
      const tx = await router.swapExactTokensForTokens(amountIn, minAmountOut, path, userAddr, deadline)
      receipt = await tx.wait()
      outputToken = path[path.length - 1]
    }
    if (step.poolType === "stable") {
      const pool = getStableSwapPoolContract(step.pool, signer)
      if (isFromNative) await wrapNative(signer, amountIn)
      const actualFrom = isFromNative ? WKAS : step.tokenIn
      if (actualFrom.toLowerCase() !== step.pool.toLowerCase()) {
        const atx = await (getErc20Contract(actualFrom, signer)).approve(step.pool, amountIn)
        await atx.wait()
      }
      const tx = await pool.exchange(step.stableIndexIn!, step.stableIndexOut!, amountIn, minAmountOut)
      receipt = await tx.wait()
      outputToken = step.tokenOut
    }
    if (step.poolType === "weighted") {
      const vault = getModuleAVaultContract(MODULE_A_ADDRESSES.vault, signer)
      if (isFromNative) {
        const tx = await vault.swapExactInKAS(step.pool, step.tokenOut, minAmountOut, deadline, { value: amountIn })
        receipt = await tx.wait()
        outputToken = step.tokenOut
      } else {
        const atx = await (getErc20Contract(step.tokenIn, signer)).approve(MODULE_A_ADDRESSES.vault, amountIn)
        await atx.wait()
        const tx = await vault.swapExactIn(step.pool, step.tokenIn, step.tokenOut, amountIn, minAmountOut, deadline)
        receipt = await tx.wait()
        outputToken = step.tokenOut
      }
    }
  }

  if (route.length === 2 && !receipt) {
    const isBothCPMM = route.every((s) => s.poolType === "cpmm")
    const isBothWeighted = route.every((s) => s.poolType === "weighted")

    if (isBothCPMM) {
      const path = [route[0].tokenIn, route[0].tokenOut, route[1].tokenOut]
      const router = getRouterContract(signer)
      let actualFrom = route[0].tokenIn
      if (isFromNative) { await wrapNative(signer, amountIn); actualFrom = WKAS }
      if (actualFrom.toLowerCase() !== WKAS) {
        const atx = await (getErc20Contract(actualFrom, signer)).approve(KASPLEX_TESTNET_ADDRESSES.router, amountIn)
        await atx.wait()
      }
      const tx = await router.swapExactTokensForTokens(amountIn, minAmountOut, path, userAddr, deadline)
      receipt = await tx.wait()
      outputToken = path[path.length - 1]
    }

    if (isBothWeighted) {
      const steps = route.map((s) => ({ pool: s.pool, tokenIn: s.tokenIn, tokenOut: s.tokenOut }))
      const vault = getModuleAVaultContract(MODULE_A_ADDRESSES.vault, signer)
      if (isFromNative) {
        const tx = await vault.batchSwapKASIn(steps, minAmountOut, deadline, { value: amountIn })
        receipt = await tx.wait()
      } else {
        const atx = await (getErc20Contract(route[0].tokenIn, signer)).approve(MODULE_A_ADDRESSES.vault, amountIn)
        await atx.wait()
        const tx = await vault.batchSwap(steps, amountIn, minAmountOut, deadline)
        receipt = await tx.wait()
      }
      outputToken = route[route.length - 1].tokenOut
    }
  }

  if (!receipt) throw new Error("No execution path for route")

  if (isToNative && outputToken?.toLowerCase() === WKAS.toLowerCase()) {
    await unwrapNative(signer, minAmountOut)
  }

  return receipt
}
