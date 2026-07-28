import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowDownUp, Settings, ChevronDown, RefreshCw, ExternalLink } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatKaspa } from "../utils/kaspa"
import { NETWORK, TOKENS, KASPA_TOKEN, SLIPPAGE_OPTIONS, DEFAULT_SLIPPAGE, SWAP_FEE_PERCENT } from "../utils/constants"
import type { TokenInfo } from "../types"

interface PoolToken {
  ticker: string
  type: "pool" | "bonding" | "amm"
  price: number
  liquidity: number
  icon: string
  poolId?: string
}

interface AmmPoolData {
  [poolId: string]: {
    type: string
    token0: string
    token1: string
    reserve0: number
    reserve1: number
    fee: number
    price: number
    k: number
  }
}

const AMM_ICONS: Record<string, string> = {
  USDT: "₮", NACHO: "🌮", KASPER: "💎", PEPEK: "🐸",
  KISHU: "🐶", GHOST: "👻", KASPY: "🐕",
}

export default function DexSwap() {
  const { connected, connect, address, balanceRaw, balanceFormatted, connecting } = useKaspaWallet()

  const [fromToken, setFromToken] = useState<TokenInfo>(KASPA_TOKEN)
  const [toToken, setToToken] = useState<TokenInfo>(TOKENS[1])
  const [fromAmount, setFromAmount] = useState("")
  const [toAmount, setToAmount] = useState("")

  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
  const [showSettings, setShowSettings] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txId, setTxId] = useState<string | null>(null)

  const [poolTokens, setPoolTokens] = useState<PoolToken[]>([])
  const [ammPools, setAmmPools] = useState<AmmPoolData>({})
  const [loadingTokens, setLoadingTokens] = useState(true)
  const [selectingToken, setSelectingToken] = useState<"from" | "to" | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const fetchTokens = useCallback(async () => {
    setLoadingTokens(true)
    try {
      const [poolRes, bondingRes, ammRes] = await Promise.all([
        fetch(`${NETWORK.backend}/api/pool/list`),
        fetch(`${NETWORK.backend}/api/bonding/tokens`),
        fetch(`${NETWORK.backend}/api/amm/pools`),
      ])
      const all: PoolToken[] = []
      if (poolRes.ok) {
        const data = await poolRes.json()
        for (const p of data.pools || []) {
          all.push({ ticker: p.ticker, type: "pool", price: p.price, liquidity: p.kasReserve, icon: "🪙" })
        }
      }
      if (bondingRes.ok) {
        const data = await bondingRes.json()
        for (const t of data || []) {
          if (!t.graduated) {
            all.push({ ticker: t.ticker, type: "bonding", price: t.currentPrice, liquidity: t.kasRaised, icon: t.icon || "🪙" })
          }
        }
      }
      const ammData: AmmPoolData = {}
      if (ammRes.ok) {
        const data = await ammRes.json()
        for (const [pid, pool] of Object.entries(data) as [string, any][]) {
          if (pool.type !== "CPMM") continue
          ammData[pid] = pool
          for (const tok of [pool.token0, pool.token1]) {
            if (tok === "KAS") continue
            if (all.some(a => a.ticker === tok)) continue
            all.push({
              ticker: tok,
              type: "amm",
              price: pool.token0 === "KAS" ? 1 / pool.price : pool.price,
              liquidity: pool.token0 === "KAS" ? pool.reserve0 : pool.reserve1,
              icon: AMM_ICONS[tok] || "🪙",
              poolId: pid,
            })
          }
        }
      }
      if (mountedRef.current) {
        setPoolTokens(all)
        setAmmPools(ammData)
      }
    } catch { /* ignore */ }
    if (mountedRef.current) setLoadingTokens(false)
  }, [])

  useEffect(() => { fetchTokens() }, [fetchTokens])

  const routeInfo = useMemo(() => {
    if (!toToken || toToken.ticker === fromToken.ticker) return null
    if (toToken.ticker === "KAS") return { type: "sell" as const, ticker: fromToken.ticker, price: 0, liquidity: 0, poolId: undefined as string | undefined }
    const pt = poolTokens.find(t => t.ticker === toToken.ticker)
    if (!pt) return null
    return { type: pt.type as "pool" | "bonding" | "amm", ticker: pt.ticker, price: pt.price, liquidity: pt.liquidity, poolId: pt.poolId }
  }, [toToken, fromToken, poolTokens])

  const estimatedOutput = useMemo(() => {
    if (!fromAmount || !routeInfo || Number(fromAmount) <= 0) return null
    const fee = Number(fromAmount) * SWAP_FEE_PERCENT / 100
    const effectiveIn = Number(fromAmount) - fee
    if (routeInfo.type === "amm") {
      const pid = routeInfo.poolId
      if (!pid || !ammPools[pid]) return null
      const pool = ammPools[pid]
      const isKasIn = pool.token0 === "KAS"
      const reserveIn = isKasIn ? pool.reserve0 : pool.reserve1
      const reserveOut = isKasIn ? pool.reserve1 : pool.reserve0
      const numerator = effectiveIn * reserveOut
      const denominator = reserveIn + effectiveIn
      return numerator / denominator
    }
    if (routeInfo.type === "pool") {
      const price = routeInfo.price
      return effectiveIn / price
    }
    if (routeInfo.type === "bonding") {
      return effectiveIn / routeInfo.price
    }
    return null
  }, [fromAmount, routeInfo, ammPools])

  const priceImpact = useMemo(() => {
    if (!fromAmount || !estimatedOutput || !routeInfo) return 0
    return Math.min(5, (Number(fromAmount) / (Number(fromAmount) + 100)) * 100)
  }, [fromAmount, estimatedOutput, routeInfo])

  const minReceived = useMemo(() => {
    if (!estimatedOutput) return null
    return estimatedOutput * (1 - slippage / 100)
  }, [estimatedOutput, slippage])

  const insufficientBalance = useMemo(() => {
    if (!connected || !fromAmount) return false
    return Number(fromAmount) > balanceRaw
  }, [connected, fromAmount, balanceRaw])

  const handleSwap = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!fromAmount || !routeInfo || Number(fromAmount) <= 0 || !window.kasware) return

    setSwapping(true)
    setError(null)
    setTxId(null)

    try {
      if (routeInfo.ticker === "KAS") {
        setSwapping(false)
        setFromAmount("")
        fetchTokens()
        return
      }

      let result: any
      if (routeInfo.type === "amm") {
        const pid = routeInfo.poolId
        if (!pid) throw new Error("No AMM pool selected")
        const res = await fetch(`${NETWORK.backend}/api/amm/swap`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pool_id: pid, token_in: "KAS", amount_in: Number(fromAmount) }),
        })
        if (!res.ok) throw new Error(await res.text())
        result = await res.json()
        setToAmount(result.amount_out.toFixed(6))
      } else if (routeInfo.type === "pool") {
        const res = await fetch(`${NETWORK.backend}/api/pool/swap/buy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: routeInfo.ticker, kas_amount: Number(fromAmount), user: address }),
        })
        if (!res.ok) throw new Error(await res.text())
        result = await res.json()
        setToAmount(result.tokens_out.toFixed(6))
      } else if (routeInfo.type === "bonding") {
        const res = await fetch(`${NETWORK.backend}/api/bonding/buy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: routeInfo.ticker, kas_amount: Number(fromAmount), buyer: address }),
        })
        if (!res.ok) throw new Error(await res.text())
        result = await res.json()
        setToAmount(result.tokens_bought.toFixed(6))
      }

      setFromAmount("")
      fetchTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, fromAmount, routeInfo, address, fetchTokens])

  const routeLabel = useMemo(() => {
    if (!routeInfo) return ""
    if (routeInfo.type === "amm") return "AMM CPMM"
    if (routeInfo.type === "pool") return "Graduated AMM"
    if (routeInfo.type === "bonding") return "Bonding Curve"
    return ""
  }, [routeInfo])

  const routeColor = useMemo(() => {
    if (!routeInfo) return ""
    if (routeInfo.type === "amm") return "text-kaspa-cyan"
    if (routeInfo.type === "pool") return "text-kaspa-purple"
    if (routeInfo.type === "bonding") return "text-kaspa-green"
    return ""
  }, [routeInfo])

  return (
    <div className="max-w-md mx-auto">
      <div className="glass rounded-2xl p-1">
        <div className="p-5 border-b border-kaspa-border/50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-display font-bold">Swap</h2>
              <p className="text-xs text-kaspa-muted mt-0.5">Built on Kaspa mainnet</p>
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
              <span className="text-sm text-kaspa-muted">You sell</span>
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
                setFromAmount(""); setToAmount(""); setError(null)
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
                value={toAmount || (estimatedOutput !== null ? estimatedOutput.toFixed(6) : "")}
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

          {routeInfo && estimatedOutput !== null && fromAmount && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="glass rounded-xl p-3 space-y-1.5 text-sm"
            >
              <div className="flex justify-between">
                <span className="text-kaspa-muted">Rate</span>
                <span>1 KAS = {routeInfo.price ? (1 / routeInfo.price).toFixed(6) : "—"} {routeInfo.ticker}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-kaspa-muted">Price impact</span>
                <span className={priceImpact > 1 ? "text-kaspa-red" : priceImpact > 0.5 ? "text-kaspa-gold" : "text-kaspa-green"}>
                  {priceImpact.toFixed(2)}%
                </span>
              </div>
              {minReceived !== null && (
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Min. received</span>
                  <span>{minReceived.toFixed(6)} {routeInfo.ticker}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-kaspa-muted">Fee</span>
                <span>{(Number(fromAmount) * SWAP_FEE_PERCENT / 100).toFixed(6)} KAS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-kaspa-muted">Route</span>
                <span className={routeColor}>{routeLabel}</span>
              </div>
              {routeInfo.type === "amm" && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-kaspa-muted">Pool</span>
                  <span className="text-kaspa-muted font-mono">{routeInfo.poolId}</span>
                </div>
              )}
              {routeInfo.type === "pool" && (
                <div className="flex justify-between text-[10px]">
                  <span className="text-kaspa-muted">Liquidity</span>
                  <span className="text-kaspa-muted">{routeInfo.liquidity?.toFixed(2) || "0"} KAS</span>
                </div>
              )}
            </motion.div>
          )}

          {!routeInfo && fromToken.ticker !== toToken.ticker && (
            <div className="text-xs text-kaspa-muted text-center py-2">
              No trading pair available for {fromToken.ticker} → {toToken.ticker}
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
            disabled={!fromAmount || Number(fromAmount) <= 0 || insufficientBalance || swapping || !routeInfo}
            className="btn-primary w-full mt-2"
          >
            {swapping ? "Swapping..." : connecting ? "Connecting..." : !connected ? "Connect KasWare"
              : insufficientBalance ? "Insufficient KAS"
              : !fromAmount ? "Enter amount"
              : !routeInfo ? "No route"
              : `Swap KAS → ${routeInfo?.ticker || "?"}`}
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
                  <p className="text-xs text-kaspa-muted mb-2">Available Tokens</p>
                  {poolTokens.map(pt => (
                    <button
                      key={pt.ticker}
                      onClick={() => {
                        const t: TokenInfo = { ticker: pt.ticker, name: pt.ticker, decimals: 8, icon: pt.icon, isKrc20: true }
                        if (selectingToken === "from") { setFromToken(t); if (toToken.ticker === pt.ticker) setToToken(fromToken) }
                        else { setToToken(t); if (fromToken.ticker === pt.ticker) setFromToken(toToken) }
                        setSelectingToken(null)
                        setToAmount("")
                      }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                        (selectingToken === "from" ? fromToken : toToken).ticker === pt.ticker ? "bg-white/10" : "hover:bg-white/5"
                      }`}
                    >
                      <span className="text-xl">{pt.icon}</span>
                      <div className="text-left flex-1">
                        <div className="font-medium">{pt.ticker}</div>
                        <div className="text-xs text-kaspa-muted">
                          {pt.type === "amm" ? "AMM CPMM" : pt.type === "pool" ? "Graduated AMM" : "Bonding Curve"} &middot; {pt.price.toFixed(6)} KAS
                        </div>
                      </div>
                      {pt.type === "pool" && <span className="text-[10px] text-kaspa-green">Graduated</span>}
                      {pt.type === "amm" && <span className="text-[10px] text-kaspa-cyan">CPMM</span>}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
