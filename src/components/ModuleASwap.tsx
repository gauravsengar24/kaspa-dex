import { useState, useCallback, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowDownUp, ChevronDown, Route, Layers } from "lucide-react"
import { ethers } from "ethers"
import TokenSelect from "./TokenSelect"
import { TOKENS, KASPA_TOKEN, SWAP_FEE_PERCENT, SLIPPAGE_OPTIONS, DEFAULT_SLIPPAGE } from "../utils/constants"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { usePrices } from "../hooks/usePrices"
import { useModuleAPools } from "../hooks/useModuleAPools"
import { formatKaspa } from "../utils/kaspa"
import { queryBatchSwap, executeBatchSwap, executeBatchSwapKASIn } from "../utils/evm"
import { MODULE_A_ADDRESSES, TESTNET_TOKENS } from "../types"
import type { TokenInfo, SwapStep } from "../types"

const TOKEN_ADDRESS: Record<string, string> = {
  KAS: MODULE_A_ADDRESSES.wkas,
  WKAS: MODULE_A_ADDRESSES.wkas,
  USDC: "0x1d5c117398cf5fcC4FeFF180c0867ac150eBD8bD",
  LINK: "0x74b768D3E4DC62AEBfa5d95ce55E62aeD33033ea",
  WBTC: "0xc5D68fbb18071C4a3c553d2f832715b66462387A",
  USDT: TESTNET_TOKENS.USDT.address,
  NACHO: TESTNET_TOKENS.NACHO.address,
}

function findRoute(
  tokenIn: string,
  tokenOut: string,
  pools: { poolAddress: string; tokens: { ticker: string }[] }[]
): SwapStep[] | null {
  if (tokenIn === tokenOut) return []
  const inAddr = TOKEN_ADDRESS[tokenIn]
  const outAddr = TOKEN_ADDRESS[tokenOut]
  if (!inAddr || !outAddr) return null
  const directPool = pools.find((p) => {
    const tickers = p.tokens.map((t) => t.ticker)
    return tickers.includes(tokenIn) && tickers.includes(tokenOut)
  })
  if (directPool) return [{ pool: directPool.poolAddress, tokenIn: inAddr, tokenOut: outAddr }]
  const wkas = TOKEN_ADDRESS.WKAS
  for (const p1 of pools) {
    const t1 = p1.tokens.map((t) => t.ticker)
    if (!t1.includes(tokenIn) || !t1.includes("WKAS")) continue
    for (const p2 of pools) {
      const t2 = p2.tokens.map((t) => t.ticker)
      if (!t2.includes("WKAS") || !t2.includes(tokenOut)) continue
      if (p1.poolAddress === p2.poolAddress) continue
      return [
        { pool: p1.poolAddress, tokenIn: inAddr, tokenOut: wkas },
        { pool: p2.poolAddress, tokenIn: wkas, tokenOut: outAddr },
      ]
    }
  }
  return null
}

export default function ModuleASwap() {
  const { connected, connect, balanceRaw, connecting, krc20Balances } = useKaspaWallet()
  const { tokenPrice } = usePrices()
  const { pools } = useModuleAPools()
  const [fromToken, setFromToken] = useState<TokenInfo>(KASPA_TOKEN)
  const [toToken, setToToken] = useState<TokenInfo>(TOKENS[1])
  const [fromAmount, setFromAmount] = useState("")
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
  const [selectingToken, setSelectingToken] = useState<"from" | "to" | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [swapTx, setSwapTx] = useState<string | null>(null)
  const [quote, setQuote] = useState<number | null>(null)

  const route = useMemo(() => {
    if (!fromToken || !toToken) return null
    return findRoute(fromToken.ticker, toToken.ticker, pools)
  }, [fromToken, toToken, pools])

  useEffect(() => {
    if (!fromAmount || isNaN(Number(fromAmount)) || Number(fromAmount) <= 0 || !route || route.length === 0) {
      setQuote(null)
      return
    }
    let cancelled = false
    const amountIn = ethers.parseEther(fromAmount)
    queryBatchSwap(route, amountIn).then(
      (r) => { if (!cancelled) setQuote(Number(ethers.formatEther(r))) },
      () => {
        const fp = tokenPrice(fromToken.ticker)
        const tp = tokenPrice(toToken.ticker)
        if (fp.kas > 0 && tp.kas > 0 && !cancelled) {
          setQuote(Number(fromAmount) * (fp.kas / tp.kas) * (1 - SWAP_FEE_PERCENT / 100))
        }
      }
    )
    return () => { cancelled = true }
  }, [fromAmount, route, tokenPrice, fromToken.ticker, toToken.ticker])

  const priceImpact = useMemo(() => {
    if (!quote || !fromAmount) return 0
    const input = Number(fromAmount)
    const impliedPrice = quote / input
    const ref = tokenPrice(fromToken.ticker).kas / (tokenPrice(toToken.ticker).kas || 1)
    return ref > 0 ? Math.abs((impliedPrice - ref) / ref) * 100 : 0
  }, [quote, fromAmount, tokenPrice, fromToken.ticker, toToken.ticker])

  const minReceived = useMemo(() => {
    if (!quote) return null
    return quote * (1 - slippage / 100)
  }, [quote, slippage])

  const handleFromAmountChange = useCallback((value: string) => {
    if (/^\d*\.?\d*$/.test(value)) setFromAmount(value)
  }, [])

  const handleFlip = useCallback(() => {
    setFromToken(toToken)
    setToToken(fromToken)
    setFromAmount("")
    setQuote(null)
  }, [fromToken, toToken])

  const handleSwap = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!fromAmount || Number(fromAmount) <= 0 || !route || route.length === 0) return
    setSwapping(true)
    setSwapError(null)
    setSwapTx(null)
    try {
      const amountIn = ethers.parseEther(fromAmount)
      const minOut = ethers.parseEther(String(minReceived ?? 0))
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20
      const isKASIn = fromToken.ticker === "KAS"
      const tx = isKASIn
        ? await executeBatchSwapKASIn(route, minOut, deadline, amountIn)
        : await executeBatchSwap(route, amountIn, minOut, deadline)
      setSwapTx(tx.hash)
      await tx.wait()
      setFromAmount("")
      setQuote(null)
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : "Swap failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, fromAmount, route, minReceived, fromToken.ticker])

  const insufficientBalance = useMemo(() => {
    if (!connected || !fromAmount || isNaN(Number(fromAmount))) return false
    return Number(fromAmount) > balanceRaw
  }, [connected, fromAmount, balanceRaw])

  const isFromKas = fromToken.ticker === KASPA_TOKEN.ticker
  const displayBalance = connected
    ? isFromKas
      ? formatKaspa(balanceRaw)
      : krc20Balances[fromToken.ticker] !== undefined ? String(krc20Balances[fromToken.ticker]) : "—"
    : "—"

  const routeLabel = useMemo(() => {
    if (!route) return "No route"
    if (route.length === 0) return "Same token"
    return `${route.length} step${route.length > 1 ? "s" : ""}`
  }, [route])

  return (
    <div className="glass rounded-2xl p-1 max-w-lg mx-auto">
      <div className="p-5 border-b border-kaspa-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-kaspa-pink" />
            <h2 className="text-lg font-display font-bold">Module A Swap</h2>
          </div>
          {route && route.length > 0 && (
            <span className="text-xs bg-kaspa-purple/20 text-kaspa-purple px-2 py-1 rounded-full flex items-center gap-1">
              <Route size={12} /> {routeLabel}
            </span>
          )}
        </div>
      </div>
      <div className="p-5 space-y-2">
        <div className={`glass rounded-xl p-4 ${insufficientBalance ? "border border-kaspa-red/50" : ""}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-kaspa-muted">You sell</span>
            <span className="text-xs text-kaspa-muted">Balance: {displayBalance} {fromToken.ticker}</span>
          </div>
          <div className="flex items-center gap-3">
            <input type="text" value={fromAmount} onChange={(e) => handleFromAmountChange(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none" />
            <button onClick={() => setSelectingToken("from")} className="flex items-center gap-2 bg-white/10 hover:bg-white/15 rounded-xl px-3 py-2 transition-all shrink-0">
              <span className="text-lg">{fromToken.icon}</span>
              <span className="font-semibold">{fromToken.ticker}</span>
              <ChevronDown size={16} className="text-kaspa-muted" />
            </button>
          </div>
        </div>
        <div className="flex justify-center -my-3 relative z-10">
          <motion.button onClick={handleFlip} whileTap={{ rotate: 180 }} className="w-10 h-10 rounded-xl glass-strong border-4 border-kaspa-dark flex items-center justify-center text-kaspa-pink hover:text-white">
            <ArrowDownUp size={18} />
          </motion.button>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-kaspa-muted">You buy</span>
          </div>
          <div className="flex items-center gap-3">
            <input type="text" value={quote !== null ? quote.toFixed(6) : ""} readOnly placeholder="0.0" className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none text-kaspa-green" />
            <button onClick={() => setSelectingToken("to")} className="flex items-center gap-2 bg-white/10 hover:bg-white/15 rounded-xl px-3 py-2 transition-all shrink-0">
              <span className="text-lg">{toToken.icon}</span>
              <span className="font-semibold">{toToken.ticker}</span>
              <ChevronDown size={16} className="text-kaspa-muted" />
            </button>
          </div>
        </div>
        {quote !== null && fromAmount && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Estimated output</span>
              <span className="font-medium">{quote.toFixed(6)} {toToken.ticker}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Price impact</span>
              <span className={priceImpact > 1 ? "text-kaspa-red" : priceImpact > 0.5 ? "text-kaspa-gold" : "text-kaspa-green"}>{priceImpact.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Min received</span>
              <span>{minReceived?.toFixed(6) || "—"} {toToken.ticker}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Route</span>
              <span className="text-kaspa-purple">{routeLabel} via Weighted Pools</span>
            </div>
          </motion.div>
        )}
        {route && route.length > 0 && (
          <div className="glass rounded-xl p-3">
            <p className="text-[10px] text-kaspa-muted uppercase tracking-wider mb-2 font-medium">Path</p>
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              {route.map((step, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i === 0 && <span className="font-medium">{fromToken.ticker}</span>}
                  <ArrowDownUp size={10} className="text-kaspa-pink rotate-90 shrink-0" />
                  <span className="text-kaspa-muted shrink-0">P{i + 1}</span>
                  <ArrowDownUp size={10} className="text-kaspa-pink rotate-90 shrink-0" />
                  <span className="font-medium">
                    {Object.entries(TOKEN_ADDRESS).find(([, v]) => v.toLowerCase() === step.tokenOut.toLowerCase())?.[0] || step.tokenOut.slice(0, 6)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
        {swapTx && (
          <div className="text-sm text-kaspa-green text-center">Swap submitted! <a href={`https://explorer.testnet.kasplextest.xyz/tx/${swapTx}`} target="_blank" rel="noopener noreferrer" className="underline">View tx</a></div>
        )}
        {swapError && <div className="text-sm text-kaspa-red text-center">{swapError}</div>}
        <button onClick={handleSwap} disabled={!fromAmount || Number(fromAmount) <= 0 || insufficientBalance || connecting || swapping || !route || route.length === 0} className="btn-primary w-full mt-2">
          {swapping ? "Swapping..." : connecting ? "Connecting..." : !connected ? "Connect Wallet" : !route ? "No route available" : "Swap via Module A"}
        </button>
      </div>
      <AnimatePresence>
        {selectingToken && (
          <TokenSelect
            onSelect={(token) => {
              if (selectingToken === "from") {
                setFromToken(token)
                if (token.ticker === toToken.ticker) setToToken(fromToken)
              } else {
                setToToken(token)
                if (token.ticker === fromToken.ticker) setFromToken(toToken)
              }
              setSelectingToken(null)
            }}
            onClose={() => setSelectingToken(null)}
            krc20Balances={krc20Balances}
            kasBalance={formatKaspa(balanceRaw)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export { findRoute, TOKEN_ADDRESS }
