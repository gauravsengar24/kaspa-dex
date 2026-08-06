import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowDownUp, Settings, ChevronDown, RefreshCw, ExternalLink } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatKaspa } from "../utils/kaspa"
import { KASPA_TOKEN, SLIPPAGE_OPTIONS, DEFAULT_SLIPPAGE } from "../utils/constants"
import type { TokenInfo } from "../types"
import {
  discoverTokens,
  getToken,
  quoteBuy,
  quoteSell,
  walletBridge,
  buyOnCurve,
  sellOnCurve,
  swapKasForToken,
  swapTokenForKas,
  type Kcc20Token,
  type Kcc20Quote,
} from "../utils/kcc20"

const AMM_ICONS: Record<string, string> = {
  USDT: "₮", NACHO: "🌮", KASPER: "💎", PEPEK: "🐸",
  KISHU: "🐶", GHOST: "👻", KASPY: "🐕",
}

interface KccRoute {
  token: Kcc20Token
  graduated: boolean
}

export default function DexSwap() {
  const { connected, connect, address, balanceRaw, connecting } = useKaspaWallet()

  const [fromToken, setFromToken] = useState<TokenInfo>(KASPA_TOKEN)
  const [toToken, setToToken] = useState<TokenInfo>(KASPA_TOKEN)
  const [fromAmount, setFromAmount] = useState("")
  const [toAmount, setToAmount] = useState("")

  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
  const [showSettings, setShowSettings] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txId, setTxId] = useState<string | null>(null)

  const [kcc20Tokens, setKcc20Tokens] = useState<Kcc20Token[]>([])
  const [loadingTokens, setLoadingTokens] = useState(true)
  const [selectingToken, setSelectingToken] = useState<"from" | "to" | null>(null)
  const [kccQuote, setKccQuote] = useState<Kcc20Quote | null>(null)
  const [quoteToken, setQuoteToken] = useState<string>("")
  const [quoteAmt, setQuoteAmt] = useState("")

  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const fetchTokens = useCallback(async () => {
    setLoadingTokens(true)
    try {
      const tokens = await discoverTokens()
      if (mountedRef.current) setKcc20Tokens(tokens)
    } catch { /* keep existing */ }
    if (mountedRef.current) setLoadingTokens(false)
  }, [])

  useEffect(() => { fetchTokens() }, [fetchTokens])

  const route = useMemo((): KccRoute | null => {
    if (toToken.ticker === "KAS" || fromToken.ticker === "KAS") {
      const targetTicker = toToken.ticker === "KAS" ? fromToken.ticker : toToken.ticker
      const token = kcc20Tokens.find(t => t.tick === targetTicker)
      if (!token) return null
      return { token, graduated: token.graduated }
    }
    return null
  }, [toToken, fromToken, kcc20Tokens])

  const sellMode = fromToken.ticker !== "KAS"

  // Live KCC-20 quote (kron-sdk quoteCpBuy / quotePoolV3Buy)
  useEffect(() => {
    if (!route || !fromAmount || Number(fromAmount) <= 0) {
      setKccQuote(null); setQuoteToken(""); setQuoteAmt(""); return
    }
    let cancelled = false
    ;(async () => {
      const amt = Number(fromAmount)
      const q = sellMode
        ? await quoteSell(route.token.tick, amt)
        : await quoteBuy(route.token.tick, amt)
      if (cancelled || !q) return
      setKccQuote(q)
      setQuoteToken(route.token.tick)
      setQuoteAmt(fromAmount)
    })()
    return () => { cancelled = true }
  }, [route, fromAmount, sellMode])

  const estimatedOutput = useMemo(() => {
    if (route && kccQuote && quoteToken === route.token.tick && quoteAmt === fromAmount) {
      return Number(kccQuote.tokenOut)
    }
    return null
  }, [route, kccQuote, quoteToken, quoteAmt, fromAmount])

  const priceImpact = useMemo(() => {
    if (!fromAmount || !estimatedOutput || !route) return 0
    return Math.min(5, (Number(fromAmount) / (Number(fromAmount) + 1000)) * 100)
  }, [fromAmount, estimatedOutput, route])

  const minReceived = useMemo(() => {
    if (estimatedOutput == null) return null
    return estimatedOutput * (1 - slippage / 100)
  }, [estimatedOutput, slippage])

  const insufficientBalance = useMemo(() => {
    if (!connected || !fromAmount) return false
    if (sellMode) return false
    return Number(fromAmount) > balanceRaw
  }, [connected, fromAmount, balanceRaw, sellMode])

  const handleSwap = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!fromAmount || !route || Number(fromAmount) <= 0 || !window.kasware) return

    setSwapping(true)
    setError(null)
    setTxId(null)

    try {
      const bridge = walletBridge()
      if (!bridge) throw new Error("KasWare wallet bridge unavailable")

      let txid: string
      if (sellMode) {
        const r = route.graduated
          ? await swapTokenForKas(route.token.tick, Number(fromAmount), bridge)
          : await sellOnCurve(route.token.tick, Number(fromAmount), bridge)
        txid = r.txid
      } else {
        const r = route.graduated
          ? await swapKasForToken(route.token.tick, Number(fromAmount), bridge)
          : await buyOnCurve(route.token.tick, Number(fromAmount), bridge)
        txid = r.txid
      }

      setTxId(txid)
      setToAmount(estimatedOutput?.toFixed(6) ?? "")
      setFromAmount("")
      fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, fromAmount, route, sellMode, estimatedOutput, fetchTokens])

  const routeLabel = useMemo(() => {
    if (!route) return ""
    return route.graduated ? "KCC-20 AMM (KRON pool)" : "KCC-20 Bonding Curve"
  }, [route])

  const routeColor = useMemo(() => {
    if (!route) return ""
    return route.graduated ? "text-kaspa-purple" : "text-kaspa-green"
  }, [route])

  return (
    <div className="max-w-md mx-auto">
      <div className="glass rounded-2xl p-1">
        <div className="p-5 border-b border-kaspa-border/50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-display font-bold">Swap</h2>
              <p className="text-xs text-kaspa-muted mt-0.5">KCC-20 · on-chain L1 (KRON covenants)</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={fetchTokens} className="btn-secondary p-2" title="Refresh">
                <RefreshCw size={14} className={loadingTokens ? "animate-spin" : ""} />
              </button>
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
                          >{s}%</button>
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
              <span className="text-sm text-kaspa-muted">{sellMode ? "You sell" : "You sell"}</span>
              <span className="text-xs text-kaspa-muted">
                Balance: {connected ? formatKaspa(balanceRaw) : "—"} {fromToken.ticker}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={fromAmount}
                onChange={e => /^\d*\.?\d*$/.test(e.target.value) && setFromAmount(e.target.value)}
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
            {insufficientBalance && (
              <p className="text-xs text-kaspa-red mt-1">Insufficient {fromToken.ticker} balance</p>
            )}
          </div>

          <div className="flex justify-center -my-3 relative z-10">
            <motion.button
              onClick={() => {
                const tmp = fromToken; setFromToken(toToken); setToToken(tmp)
                setFromAmount(""); setToAmount(""); setError(null); setKccQuote(null)
              }}
              className="w-10 h-10 rounded-xl glass-strong border-4 border-kaspa-dark flex items-center justify-center text-kaspa-pink hover:text-white transition-colors"
            >
              <ArrowDownUp size={18} />
            </motion.button>
          </div>

          <div className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-kaspa-muted">You receive</span>
              <span className="text-xs text-kaspa-muted">
                Balance: {toAmount || "—"} {toToken.ticker}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={toAmount || (estimatedOutput != null ? estimatedOutput.toFixed(6) : "")}
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

          {route && estimatedOutput != null && fromAmount && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="glass rounded-xl p-3 space-y-1.5 text-sm"
            >
              <div className="flex justify-between">
                <span className="text-kaspa-muted">Rate</span>
                <span>{kccQuote?.price ? (1 / kccQuote.price).toFixed(6) : "—"} {route.token.tick}</span>
              </div>
              {minReceived != null && (
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Min. received</span>
                  <span>{minReceived.toFixed(6)} {route.token.tick}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-kaspa-muted">Price impact</span>
                <span className={priceImpact > 1 ? "text-kaspa-red" : priceImpact > 0.5 ? "text-kaspa-gold" : "text-kaspa-green"}>
                  {priceImpact.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-kaspa-muted">Route</span>
                <span className={routeColor}>{routeLabel}</span>
              </div>
            </motion.div>
          )}

          {!route && fromToken.ticker !== toToken.ticker && (
            <div className="text-xs text-kaspa-muted text-center py-2">
              Only KAS ↔ KCC-20 pairs are supported on-chain. Select a KRON token.
            </div>
          )}

          {txId && (
            <div className="glass rounded-xl p-3 text-sm text-kaspa-green text-center">
              TX submitted!{" "}
              <a href={`https://explorer.kaspa.org/transactions/${txId}`} target="_blank" rel="noopener noreferrer" className="underline">
                View <ExternalLink size={10} className="inline" />
              </a>
            </div>
          )}

          {error && (
            <div className="glass rounded-xl p-3 text-sm text-kaspa-red text-center">{error}</div>
          )}

          <button
            onClick={handleSwap}
            disabled={!fromAmount || Number(fromAmount) <= 0 || insufficientBalance || swapping || !route}
            className="btn-primary w-full mt-2"
          >
            {swapping ? "Swapping..." : connecting ? "Connecting..." : !connected ? "Connect KasWare"
              : insufficientBalance ? "Insufficient KAS"
              : !fromAmount ? "Enter amount"
              : !route ? "Select token"
              : sellMode ? `Swap ${route.token.tick} → KAS`
              : `Swap KAS → ${route.token.tick}`}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {selectingToken && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSelectingToken(null)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="relative glass-strong rounded-2xl p-5 w-full max-w-sm"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Select Token</h3>
                <button onClick={() => setSelectingToken(null)} className="text-kaspa-muted hover:text-white text-xl leading-none">&times;</button>
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                <button
                  onClick={() => {
                    if (selectingToken === "from") setFromToken(KASPA_TOKEN)
                    else setToToken(KASPA_TOKEN)
                    setSelectingToken(null)
                    setToAmount("")
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                    (selectingToken === "from" ? fromToken : toToken).ticker === "KAS" ? "bg-white/10" : "hover:bg-white/5"
                  }`}
                >
                  <span className="text-xl">{KASPA_TOKEN.icon}</span>
                  <div className="text-left">
                    <div className="font-medium">{KASPA_TOKEN.ticker}</div>
                    <div className="text-xs text-kaspa-muted">{formatKaspa(balanceRaw)}</div>
                  </div>
                </button>
                <div className="border-t border-kaspa-border/30 my-2 pt-2">
                  <p className="text-xs text-kaspa-muted mb-2">KCC-20 Tokens (KRON indexer)</p>
                  {loadingTokens ? (
                    <div className="text-sm text-kaspa-muted text-center py-4">Loading...</div>
                  ) : (
                    kcc20Tokens.map(tok => {
                      const icon = AMM_ICONS[tok.tick.toUpperCase()] || tok.toTokenInfo().icon || "🪙"
                      return (
                        <button
                          key={tok.tick}
                          onClick={() => {
                            const t: TokenInfo = tok.toTokenInfo()
                            if (selectingToken === "from") { setFromToken(t); if (toToken.ticker === tok.tick) setToToken(fromToken) }
                            else { setToToken(t); if (fromToken.ticker === tok.tick) setFromToken(toToken) }
                            setSelectingToken(null)
                            setToAmount("")
                            setKccQuote(null)
                          }}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                            (selectingToken === "from" ? fromToken : toToken).ticker === tok.tick ? "bg-white/10" : "hover:bg-white/5"
                          }`}
                        >
                          <span className="text-xl">{icon}</span>
                          <div className="text-left flex-1">
                            <div className="font-medium">{tok.tick}</div>
                            <div className="text-xs text-kaspa-muted">
                              {tok.graduated ? "KRON AMM" : "Bonding Curve"} · {tok.decimals} dec
                            </div>
                          </div>
                          {tok.graduated && <span className="text-[10px] text-kaspa-purple">Graduated</span>}
                          {!tok.graduated && <span className="text-[10px] text-kaspa-green">Curve</span>}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}