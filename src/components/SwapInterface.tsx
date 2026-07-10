import { useState, useCallback, useMemo, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowDownUp, Settings, ChevronDown } from "lucide-react"
import { ethers } from "ethers"
import TokenSelect from "./TokenSelect"
import {
  TOKENS,
  KASPA_TOKEN,
  SWAP_FEE_PERCENT,
  SLIPPAGE_OPTIONS,
  DEFAULT_SLIPPAGE,
} from "../utils/constants"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { usePrices } from "../hooks/usePrices"
import { usePools } from "../hooks/usePools"
import { useModuleAPools } from "../hooks/useModuleAPools"
import { formatKaspa, formatUsd } from "../utils/kaspa"
import {
  getProviderAddress,
  getTokenBalance as getEvmTokenBalance,
} from "../utils/evm"
import { findRoute, queryRoute, executeRoute } from "../utils/router"
import { MODULE_A_ADDRESSES, STABLESWAP_POOL_ADDRESS, KASPLEX_TESTNET_ADDRESSES } from "../types"
import type { TokenInfo } from "../types"

const WKAS = KASPLEX_TESTNET_ADDRESSES.wkas

const TOKEN_ADDRESS_MAP: Record<string, string> = {
  KAS: WKAS,
  WKAS: WKAS,
  USDC: "0xB0c9d7e1e5635a1FBFfC8CFD75CE16BA1ccf2849",
  USDT: "0xffe75a83620025ADa3742b19163D7E9BE2b2322f",
  WBTC: "0x42134d776638D67e24cFA0d316f58B5e52cF885f",
  LINK: "0xa2E3e66262825cA2C6a7352d4F5a1Ba9E82Ff89c",
  TUSD: "0xE3ADCE18f646BF44c263319ABffB33b83F0B5A35",
  NACHO: "0x556fa22558Eaa84E7686E8eAbE7582930BB1b4DB",
  KASPY: "0x022fb99D9563858E296F572Ba4d85F268042850F",
  GHOST: "0x3533ff5E15be8D650D089c39B43797451e53F5cD",
}

export default function SwapInterface() {
  const { connected, connect, balanceRaw, balanceFormatted, connecting, krc20Balances, address } = useKaspaWallet()
  const { prices, tokenPrice } = usePrices()
  const { pools: cpmmPools, loading: cpmmLoading } = usePools()
  const { pools: moduleAPools, loading: moduleALoading } = useModuleAPools()
  const [fromToken, setFromToken] = useState<TokenInfo>(KASPA_TOKEN)
  const [toToken, setToToken] = useState<TokenInfo>(TOKENS[1])
  const [fromAmount, setFromAmount] = useState("")
  const [toAmount, setToAmount] = useState("")
  const [flipping, setFlipping] = useState(false)
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
  const [showSettings, setShowSettings] = useState(false)
  const [selectingToken, setSelectingToken] = useState<"from" | "to" | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [swapTx, setSwapTx] = useState<string | null>(null)
  const [userAddress, setUserAddress] = useState<string | null>(null)
  const [fromBalance, setFromBalance] = useState<number | null>(null)
  const [toBalance, setToBalance] = useState<number | null>(null)

  useEffect(() => {
    if (connected) {
      getProviderAddress().then(setUserAddress).catch(async () => {
        try {
          const evm = (window as any).kasware?.ethereum
          if (evm) await evm.request({ method: "eth_requestAccounts", params: [] })
          const addr = await getProviderAddress()
          setUserAddress(addr)
        } catch {
          setUserAddress(null)
        }
      })
    } else {
      setUserAddress(null)
      setFromBalance(null)
      setToBalance(null)
    }
  }, [connected])

  useEffect(() => {
    if (!connected) { setFromBalance(null); setToBalance(null); return }
    let cancelled = false
    const fetchBalances = async () => {
      const getBalance = async (ticker: string): Promise<number | null> => {
        if (ticker === KASPA_TOKEN.ticker || ticker === "WKAS") return balanceRaw
        if (userAddress) {
          const evmAddr = TOKEN_ADDRESS_MAP[ticker]
          if (evmAddr) {
            try {
              const bal = await getEvmTokenBalance(evmAddr, userAddress)
              return Number(ethers.formatEther(bal))
            } catch { return null }
          }
        }
        if (krc20Balances[ticker] !== undefined) return krc20Balances[ticker]
        return null
      }
      const fb = await getBalance(fromToken.ticker)
      const tb = await getBalance(toToken.ticker)
      if (!cancelled) { setFromBalance(fb); setToBalance(tb) }
    }
    fetchBalances()
    return () => { cancelled = true }
  }, [connected, userAddress, fromToken.ticker, toToken.ticker, balanceRaw, krc20Balances])

  const poolsContext = useMemo(() => ({
    cpmm: cpmmPools.map((p) => ({ pairAddress: p.id, token0: TOKEN_ADDRESS_MAP[p.token0 === "KAS" ? "WKAS" : p.token0] || p.id, token1: TOKEN_ADDRESS_MAP[p.token1 === "KAS" ? "WKAS" : p.token1] || p.id })),
    weighted: moduleAPools.filter((p) => p.poolAddress !== STABLESWAP_POOL_ADDRESS).map((p) => ({
      poolAddress: p.poolAddress,
      tokens: p.tokens.map((t) => ({ ticker: t.ticker, address: TOKEN_ADDRESS_MAP[t.ticker] || t.address })),
    })),
    stable: moduleAPools.filter((p) => p.poolAddress === STABLESWAP_POOL_ADDRESS).map((p) => ({
      poolAddress: p.poolAddress,
      tokens: p.tokens.map((t) => ({ ticker: t.ticker, address: TOKEN_ADDRESS_MAP[t.ticker] || t.address })),
    })),
  }), [cpmmPools, moduleAPools])

  const route = useMemo(() => {
    return findRoute(fromToken.ticker, toToken.ticker, TOKEN_ADDRESS_MAP, poolsContext)
  }, [fromToken.ticker, toToken.ticker, poolsContext])

  const liveRate = useMemo(() => {
    const fp = tokenPrice(fromToken.ticker)
    const tp = tokenPrice(toToken.ticker)
    if (fp.kas > 0 && tp.kas > 0) return fp.kas / tp.kas
    return null
  }, [fromToken.ticker, toToken.ticker, tokenPrice])

  const [estimatedOutput, setEstimatedOutput] = useState<number | null>(null)
  const [quoting, setQuoting] = useState(false)

  useEffect(() => {
    if (!fromAmount || isNaN(Number(fromAmount)) || Number(fromAmount) <= 0 || !route || route.length === 0) {
      setEstimatedOutput(null)
      return
    }
    let cancelled = false
    const doQuote = async () => {
      setQuoting(true)
      try {
        const amountIn = ethers.parseEther(fromAmount)
        const out = await queryRoute(route, amountIn)
        if (!cancelled) {
          setEstimatedOutput(out !== null ? Number(ethers.formatEther(out)) : null)
        }
      } catch {
        if (!cancelled) {
          const fp = tokenPrice(fromToken.ticker)
          const tp = tokenPrice(toToken.ticker)
          if (fp.kas > 0 && tp.kas > 0 && !cancelled) {
            setEstimatedOutput(Number(fromAmount) * (fp.kas / tp.kas) * (1 - SWAP_FEE_PERCENT / 100))
          }
        }
      } finally { if (!cancelled) setQuoting(false) }
    }
    doQuote()
    return () => { cancelled = true }
  }, [fromAmount, route, tokenPrice, fromToken.ticker, toToken.ticker])

  const priceImpact = useMemo(() => {
    if (!estimatedOutput || !fromAmount) return 0
    const input = Number(fromAmount)
    const impliedPrice = estimatedOutput / input
    const ref = liveRate || 200
    return Math.abs((impliedPrice - ref) / ref) * 100
  }, [estimatedOutput, fromAmount, liveRate])

  const minReceived = useMemo(() => {
    if (!estimatedOutput) return null
    return estimatedOutput * (1 - slippage / 100)
  }, [estimatedOutput, slippage])

  const usdValue = useMemo(() => {
    if (!fromAmount || isNaN(Number(fromAmount))) return null
    const p = tokenPrice(fromToken.ticker)
    if (p.usd === 0) return null
    return Number(fromAmount) * p.usd
  }, [fromAmount, fromToken.ticker, tokenPrice])

  const handleFromAmountChange = useCallback((value: string) => {
    if (/^\d*\.?\d*$/.test(value)) setFromAmount(value)
  }, [])

  const handleFlip = useCallback(() => {
    setFlipping(true)
    setSwapError(null)
    setSwapTx(null)
    setEstimatedOutput(null)
    setTimeout(() => {
      setFromBalance(null)
      setToBalance(null)
      setFromToken(toToken)
      setToToken(fromToken)
      setFromAmount("")
      setToAmount("")
      setFlipping(false)
    }, 150)
  }, [fromToken, toToken])

  const handleSwap = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!fromAmount || Number(fromAmount) <= 0 || !route || route.length === 0 || !estimatedOutput) return

    setSwapping(true)
    setSwapError(null)
    setSwapTx(null)

    try {
      const amountIn = ethers.parseEther(fromAmount)
      const minOut = ethers.parseEther(minReceived!.toFixed(18))
      const receipt = await executeRoute(route, amountIn, minOut, fromToken.ticker, toToken.ticker)
      setSwapTx(receipt.hash)
      setFromAmount("")
      setEstimatedOutput(null)
    } catch (err) {
      setSwapTx(null)
      setSwapError(err instanceof Error ? err.message : "Swap failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, fromAmount, estimatedOutput, minReceived, route, fromToken.ticker])

  const displayBalance = useCallback((bal: number | null, ticker: string): string => {
    if (bal === null) return "—"
    if (ticker === KASPA_TOKEN.ticker || ticker === "WKAS") return formatKaspa(bal)
    return String(bal)
  }, [])

  const insufficientBalance = useMemo(() => {
    if (!connected || !fromAmount || isNaN(Number(fromAmount))) return false
    if (fromBalance === null) return true
    return Number(fromAmount) > fromBalance
  }, [connected, fromAmount, fromBalance])

  const kasUsdPrice = prices.kas.usd > 0 ? formatUsd(prices.kas.usd) : "—"

  const routeLabel = useMemo(() => {
    if (!route) return "No route"
    if (route.length === 0) return "Same token"
    const types = [...new Set(route.map((r) => r.poolType))]
    const typeLabel = types.includes("stable") ? "StableSwap" : types.includes("weighted") ? "Weighted" : "CPMM"
    return `${route.length} step${route.length > 1 ? "s" : ""} via ${typeLabel}`
  }, [route])

  return (
    <div className="glass rounded-2xl p-1">
      <div className="p-5 border-b border-kaspa-border/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-display font-bold">Swap</h2>
            <p className="text-xs text-kaspa-muted mt-0.5">KAS • {kasUsdPrice}</p>
          </div>
          <div className="flex items-center gap-2">
            {route && route.length > 0 && (
              <span className="text-[10px] bg-kaspa-purple/20 text-kaspa-purple px-2 py-1 rounded-full">{routeLabel}</span>
            )}
            <div className="relative">
              <button onClick={() => setShowSettings(!showSettings)} className="btn-secondary p-2" aria-label="Settings">
                <Settings size={16} />
              </button>
              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-10 glass-strong rounded-xl p-4 w-64 z-20"
                  >
                    <p className="text-sm font-medium mb-3">Slippage Tolerance</p>
                    <div className="flex gap-2">
                      {SLIPPAGE_OPTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => setSlippage(s)}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                            slippage === s ? "bg-kaspa-pink text-white" : "bg-white/5 hover:bg-white/10 text-kaspa-muted"
                          }`}
                        >
                          {s}%
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-2">
        <div className={`glass rounded-xl p-4 ${insufficientBalance ? "border border-kaspa-red/50" : ""}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-kaspa-muted">You sell</span>
            <span className="text-xs text-kaspa-muted">
              Balance: {displayBalance(fromBalance, fromToken.ticker)} {fromToken.ticker}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={fromAmount}
              onChange={(e) => handleFromAmountChange(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none"
            />
            <button
              onClick={() => setSelectingToken("from")}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/15 rounded-xl px-3 py-2 transition-all shrink-0"
            >
              <span className="text-lg">{fromToken.icon}</span>
              <span className="font-semibold">{fromToken.ticker}</span>
              <ChevronDown size={16} className="text-kaspa-muted" />
            </button>
          </div>
          {usdValue !== null && fromAmount && (
            <p className="text-xs text-kaspa-muted mt-1">~${usdValue.toFixed(2)}</p>
          )}
          {insufficientBalance && (
            <p className="text-xs text-kaspa-red mt-1">Insufficient {fromToken.ticker} balance</p>
          )}
        </div>

        <div className="flex justify-center -my-3 relative z-10">
          <motion.button
            onClick={handleFlip}
            animate={{ rotate: flipping ? 180 : 0 }}
            transition={{ duration: 0.3 }}
            className="w-10 h-10 rounded-xl glass-strong border-4 border-kaspa-dark flex items-center justify-center text-kaspa-pink hover:text-white hover:border-kaspa-pink/30 transition-colors"
          >
            <ArrowDownUp size={18} />
          </motion.button>
        </div>

        <div className="glass rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-kaspa-muted">You buy</span>
            <span className="text-xs text-kaspa-muted">
              Balance: {displayBalance(toBalance, toToken.ticker)} {toToken.ticker}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={estimatedOutput !== null ? estimatedOutput.toFixed(6) : toAmount}
              readOnly
              placeholder="0.0"
              className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none text-kaspa-green"
            />
            <button
              onClick={() => setSelectingToken("to")}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/15 rounded-xl px-3 py-2 transition-all shrink-0"
            >
              <span className="text-lg">{toToken.icon}</span>
              <span className="font-semibold">{toToken.ticker}</span>
              <ChevronDown size={16} className="text-kaspa-muted" />
            </button>
          </div>
        </div>

        {liveRate !== null && (
          <div className="flex items-center justify-center gap-1 text-xs text-kaspa-muted py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-kaspa-green" />
            {prices.kas.usd > 0 && <span>1 KAS = {formatUsd(prices.kas.usd)}</span>}
            <span className="mx-1.5">•</span>
            <span>1 {fromToken.ticker} ≈ {liveRate.toFixed(6)} {toToken.ticker}</span>
          </div>
        )}

        {estimatedOutput !== null && fromAmount && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="glass rounded-xl p-3 space-y-1.5 text-sm"
          >
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Rate</span>
              <span>1 {fromToken.ticker} = {liveRate?.toFixed(6) || "—"} {toToken.ticker}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Price impact</span>
              <span className={priceImpact > 1 ? "text-kaspa-red" : priceImpact > 0.5 ? "text-kaspa-gold" : "text-kaspa-green"}>{priceImpact.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Min. received</span>
              <span>{formatKaspa(minReceived!)} {toToken.ticker}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Fee</span>
              <span>{(Number(fromAmount) * SWAP_FEE_PERCENT / 100).toFixed(6)} {fromToken.ticker}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Route</span>
              <span className={route?.[0]?.poolType === "stable" ? "text-kaspa-cyan" : route?.[0]?.poolType === "weighted" ? "text-kaspa-purple" : "text-kaspa-green"}>
                {routeLabel}
              </span>
            </div>
          </motion.div>
        )}

        {quoting && <div className="text-xs text-kaspa-muted text-center py-1">Getting quote...</div>}

        {swapTx && (
          <div className="glass rounded-xl p-3 text-sm text-kaspa-green text-center">
            Swap submitted!{" "}
            <a href={`https://explorer.testnet.kasplextest.xyz/tx/${swapTx}`} target="_blank" rel="noopener noreferrer" className="underline">View tx</a>
          </div>
        )}

        {swapError && (
          <div className="glass rounded-xl p-3 text-sm text-kaspa-red text-center">{swapError}</div>
        )}

        {insufficientBalance && fromAmount && (
          <div className="glass rounded-xl p-3 text-sm text-kaspa-red text-center">
            Insufficient {fromToken.ticker} balance{connected ? ` — you have ${displayBalance(fromBalance, fromToken.ticker)} ${fromToken.ticker}` : ""}
          </div>
        )}

        <button
          onClick={handleSwap}
          disabled={!fromAmount || Number(fromAmount) <= 0 || insufficientBalance || connecting || swapping || quoting || !route || route.length === 0}
          className="btn-primary w-full mt-2"
        >
          {swapping ? "Swapping..." : connecting ? "Connecting..." : !connected ? "Connect Wallet"
            : insufficientBalance ? `Insufficient ${fromToken.ticker}`
            : !fromAmount || Number(fromAmount) <= 0 ? "Enter an amount"
            : !route ? "No route available"
            : quoting ? "Getting quote..."
            : "Swap"}
        </button>
      </div>

      <AnimatePresence>
        {selectingToken && (
          <TokenSelect
            onSelect={(token) => {
              if (selectingToken === "from") {
                setFromBalance(null)
                setFromToken(token)
                if (token.ticker === toToken.ticker) setToToken(fromToken)
              } else {
                setToBalance(null)
                setToToken(token)
                if (token.ticker === fromToken.ticker) setFromToken(toToken)
              }
              setSelectingToken(null)
            }}
            onClose={() => setSelectingToken(null)}
            krc20Balances={krc20Balances}
            kasBalance={balanceFormatted}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
