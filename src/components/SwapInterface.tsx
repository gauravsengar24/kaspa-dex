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
import { formatKaspa, formatUsd } from "../utils/kaspa"
import {
  fetchPairReserves,
  executeSwap,
  approveToken,
  getProviderAddress,
  getRpcProvider,
  wrapKAS,
  unwrapWKAS,
  getTokenBalance as getEvmTokenBalance,
} from "../utils/evm"
import { KASPLEX_TESTNET_ADDRESSES } from "../types"
import type { TokenInfo } from "../types"

const TOKEN_ADDRESS_MAP: Record<string, string> = {
  KAS: KASPLEX_TESTNET_ADDRESSES.wkas,
  WKAS: KASPLEX_TESTNET_ADDRESSES.wkas,
  USDC: "0xB0c9d7e1e5635a1FBFfC8CFD75CE16BA1ccf2849",
  USDT: "0xffe75a83620025ADa3742b19163D7E9BE2b2322f",
  WBTC: "0x42134d776638D67e24cFA0d316f58B5e52cF885f",
  LINK: "0xa2E3e66262825cA2C6a7352d4F5a1Ba9E82Ff89c",
  TUSD: "0xE3ADCE18f646BF44c263319ABffB33b83F0B5A35",
  NACHO: "0x556fa22558Eaa84E7686E8eAbE7582930BB1b4DB",
}

export default function SwapInterface() {
  const { connected, connect, balanceRaw, balanceFormatted, connecting, krc20Balances, address } = useKaspaWallet()
  const { prices, tokenPrice } = usePrices()
  const { pools, loading } = usePools()
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
  const [fromBalance, setFromBalance] = useState<string>("—")
  const [toBalance, setToBalance] = useState<string>("—")

  useEffect(() => {
    if (connected) {
      getProviderAddress().then(setUserAddress).catch(() => setUserAddress(null))
    } else {
      setUserAddress(null)
      setFromBalance("—")
      setToBalance("—")
    }
  }, [connected])

  useEffect(() => {
    if (!connected || !userAddress) { setFromBalance("—"); setToBalance("—"); return }
    let cancelled = false
    const fetchBalances = async () => {
      const getBalance = async (ticker: string): Promise<string> => {
        if (ticker === KASPA_TOKEN.ticker || ticker === "WKAS") {
          return formatKaspa(balanceRaw)
        }
        const evmAddr = getTokenAddress(ticker)
        if (evmAddr) {
          try {
            const bal = await getEvmTokenBalance(evmAddr, userAddress)
            return ethers.formatEther(bal)
          } catch {
            return "—"
          }
        }
        if (krc20Balances[ticker] !== undefined) {
          return String(krc20Balances[ticker])
        }
        return "—"
      }
      const fb = await getBalance(fromToken.ticker)
      const tb = await getBalance(toToken.ticker)
      if (!cancelled) {
        setFromBalance(fb)
        setToBalance(tb)
      }
    }
    fetchBalances()
    return () => { cancelled = true }
  }, [connected, userAddress, fromToken.ticker, toToken.ticker, balanceRaw, krc20Balances])

  const liveRate = useMemo(() => {
    const fp = tokenPrice(fromToken.ticker)
    const tp = tokenPrice(toToken.ticker)
    if (fp.kas > 0 && tp.kas > 0) return fp.kas / tp.kas
    return null
  }, [fromToken.ticker, toToken.ticker, tokenPrice])

  const estimatedOutput = useMemo(() => {
    if (!fromAmount || isNaN(Number(fromAmount)) || Number(fromAmount) <= 0) return null
    const inputNum = Number(fromAmount)

    const pair = pools.find(
      (p) =>
        (p.token0 === fromToken.ticker && p.token1 === toToken.ticker) ||
        (p.token0 === toToken.ticker && p.token1 === fromToken.ticker)
    )
    if (pair) {
      const tok0In = pair.token0 === fromToken.ticker
      const rIn = tok0In ? Number(pair.reserve0) : Number(pair.reserve1)
      const rOut = tok0In ? Number(pair.reserve1) : Number(pair.reserve0)
      if (rIn > 0 && rOut > 0) {
        const fee = inputNum * (SWAP_FEE_PERCENT / 100)
        const effectiveInput = inputNum - fee
        const numerator = effectiveInput * rOut
        const denominator = rIn + effectiveInput
        return numerator / denominator
      }
    }
    if (liveRate) {
      return inputNum * liveRate * (1 - SWAP_FEE_PERCENT / 100)
    }
    return null
  }, [fromAmount, liveRate, fromToken.ticker, toToken.ticker, pools])

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
    if (/^\d*\.?\d*$/.test(value)) {
      setFromAmount(value)
    }
  }, [])

  const handleFlip = useCallback(() => {
    setFlipping(true)
    setSwapError(null)
    setSwapTx(null)
    setTimeout(() => {
      setFromBalance("—")
      setToBalance("—")
      setFromToken(toToken)
      setToToken(fromToken)
      setFromAmount("")
      setToAmount("")
      setFlipping(false)
    }, 150)
  }, [fromToken, toToken])

  const getTokenAddress = useCallback((ticker: string): string | null => {
    return TOKEN_ADDRESS_MAP[ticker] ?? null
  }, [])

  const handleSwap = useCallback(async () => {
    if (!connected) {
      await connect()
      return
    }
    if (!fromAmount || Number(fromAmount) <= 0 || !estimatedOutput) return

    setSwapping(true)
    setSwapError(null)
    setSwapTx(null)

    try {
      const fromAddr = getTokenAddress(fromToken.ticker)
      const toAddr = getTokenAddress(toToken.ticker)
      if (!fromAddr || !toAddr) {
        throw new Error(`Unsupported token pair: ${fromToken.ticker} → ${toToken.ticker}`)
      }

      const amountIn = ethers.parseEther(fromAmount)
      const amountOutMin = ethers.parseEther(estimatedOutput.toFixed(18))

      let actualFrom = fromAddr
      let actualTo = toAddr
      const isFromNative = fromToken.ticker === "KAS"
      const isToNative = toToken.ticker === "KAS"

      if (isFromNative) {
        const wrapTx = await wrapKAS(amountIn)
        await wrapTx.wait()
        actualFrom = KASPLEX_TESTNET_ADDRESSES.wkas
      }

      const wkasAddr = KASPLEX_TESTNET_ADDRESSES.wkas
      const path = isToNative ? [actualFrom, wkasAddr] : [actualFrom, actualTo]

      if (actualFrom !== wkasAddr) {
        await approveToken(actualFrom, KASPLEX_TESTNET_ADDRESSES.router, amountIn)
      }

      const deadline = Math.floor(Date.now() / 1000) + 60 * 20
      const tx = await executeSwap(amountIn, amountOutMin, path, deadline)
      setSwapTx(tx.hash)
      await tx.wait()

      if (isToNative) {
        const unwrapTx = await unwrapWKAS(amountOutMin)
        await unwrapTx.wait()
      }

      setFromAmount("")
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : "Swap failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, fromAmount, estimatedOutput, fromToken.ticker, toToken.ticker, getTokenAddress])

  const insufficientBalance = useMemo(() => {
    if (!connected || !fromAmount || isNaN(Number(fromAmount)) || fromBalance === "—") return false
    return Number(fromAmount) > Number(fromBalance)
  }, [connected, fromAmount, fromBalance])

  const kasUsdPrice = prices.kas.usd > 0 ? formatUsd(prices.kas.usd) : "—"

  return (
    <div className="glass rounded-2xl p-1">
      <div className="p-5 border-b border-kaspa-border/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-display font-bold">Swap</h2>
            <p className="text-xs text-kaspa-muted mt-0.5">KAS • {kasUsdPrice}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="btn-secondary p-2"
                aria-label="Settings"
              >
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
                            slippage === s
                              ? "bg-kaspa-pink text-white"
                              : "bg-white/5 hover:bg-white/10 text-kaspa-muted"
                          }`}
                        >
                          {s}%
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-kaspa-muted mt-2">
                      Your transaction will revert if the price changes by more than this amount.
                    </p>
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
              Balance: {fromBalance} {fromToken.ticker}
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
              Balance: {toBalance} {toToken.ticker}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={toAmount}
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
            {prices.kas.usd > 0 && (
              <span>1 KAS = {formatUsd(prices.kas.usd)}</span>
            )}
            <span className="mx-1.5">•</span>
            <span>
              1 {fromToken.ticker} ≈ {liveRate.toFixed(6)} {toToken.ticker}
            </span>
          </div>
        )}

        {pools.length === 0 && !loading && (
          <div className="text-center text-sm text-kaspa-muted py-3">
            No liquidity pools yet. Deploy a pair to enable swaps.
          </div>
        )}

        {estimatedOutput !== null && fromAmount && pools.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="glass rounded-xl p-3 space-y-1.5 text-sm"
          >
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Rate</span>
              <span>
                1 {fromToken.ticker} = {liveRate?.toFixed(6) || "—"} {toToken.ticker}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Price impact</span>
              <span
                className={
                  priceImpact > 1
                    ? "text-kaspa-red"
                    : priceImpact > 0.5
                      ? "text-kaspa-gold"
                      : "text-kaspa-green"
                }
              >
                {priceImpact.toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Min. received</span>
              <span>
                {formatKaspa(minReceived!)} {toToken.ticker}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-kaspa-muted">Fee ({SWAP_FEE_PERCENT}%)</span>
              <span>
                {(Number(fromAmount) * SWAP_FEE_PERCENT / 100).toFixed(6)} {fromToken.ticker}
              </span>
            </div>
          </motion.div>
        )}

        {swapTx && (
          <div className="glass rounded-xl p-3 text-sm text-kaspa-green text-center">
            Swap successful!{" "}
            <a
              href={`https://explorer.testnet.kasplextest.xyz/tx/${swapTx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View tx
            </a>
          </div>
        )}

        {swapError && (
          <div className="glass rounded-xl p-3 text-sm text-kaspa-red text-center">
            {swapError}
          </div>
        )}

        {insufficientBalance && fromAmount && (
          <div className="glass rounded-xl p-3 text-sm text-kaspa-red text-center">
            Insufficient {fromToken.ticker} balance{connected ? ` — you have ${fromBalance} ${fromToken.ticker}` : ""}
          </div>
        )}

        <button
          onClick={handleSwap}
          disabled={
            !fromAmount || Number(fromAmount) <= 0 || insufficientBalance || connecting || swapping
          }
          className="btn-primary w-full mt-2"
        >
          {swapping
            ? "Swapping..."
            : connecting
              ? "Connecting..."
              : !connected
                ? "Connect Wallet"
                : insufficientBalance
                  ? `Insufficient ${fromToken.ticker}`
                  : !fromAmount || Number(fromAmount) <= 0
                    ? "Enter an amount"
                    : pools.length === 0
                      ? "No pools available"
                      : "Swap"}
        </button>
      </div>

      <AnimatePresence>
        {selectingToken && (
          <TokenSelect
            onSelect={(token) => {
              if (selectingToken === "from") {
                setFromBalance("—")
                setFromToken(token)
                if (token.ticker === toToken.ticker) setToToken(fromToken)
              } else {
                setToBalance("—")
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
