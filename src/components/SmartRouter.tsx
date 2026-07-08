import { useState } from "react"
import { motion } from "framer-motion"
import { Route, ArrowRight, Split, Layers, Zap } from "lucide-react"
import { NETWORK } from "../utils/constants"
import { formatKaspa } from "../utils/kaspa"
import type { RouterQuote } from "../types"

export default function SmartRouter() {
  const [tokenIn, setTokenIn] = useState("KAS")
  const [tokenOut, setTokenOut] = useState("NACHO")
  const [amountIn, setAmountIn] = useState("")
  const [quote, setQuote] = useState<RouterQuote | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchQuote = async () => {
    if (!amountIn) return
    setLoading(true)
    try {
      const res = await fetch(
        `${NETWORK.backend}/api/router/quote?token_in=${tokenIn}&token_out=${tokenOut}&amount_in=${amountIn}`
      )
      const data = await res.json()
      setQuote(data)
    } catch {}
    setLoading(false)
  }

  const tokens = ["KAS", "USDT", "NACHO", "KASPY", "GHOST", "KASPER"]

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-display font-bold">Smart Router</h1>
        <p className="text-kaspa-muted text-sm mt-1">Find the best routes across all liquidity pools</p>
      </div>

      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <p className="text-xs text-kaspa-muted mb-2">From</p>
            <select value={tokenIn} onChange={(e) => setTokenIn(e.target.value)}
              className="w-full glass rounded-xl p-3 text-sm font-medium outline-none appearance-none cursor-pointer">
              {tokens.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button className="mt-6 w-8 h-8 rounded-lg glass flex items-center justify-center text-kaspa-muted hover:text-white">
            <ArrowRight size={16} />
          </button>
          <div className="flex-1">
            <p className="text-xs text-kaspa-muted mb-2">To</p>
            <select value={tokenOut} onChange={(e) => setTokenOut(e.target.value)}
              className="w-full glass rounded-xl p-3 text-sm font-medium outline-none appearance-none cursor-pointer">
              {tokens.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="glass rounded-xl p-4 mb-4">
          <p className="text-xs text-kaspa-muted mb-2">Amount In</p>
          <input type="text" value={amountIn}
            onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmountIn(e.target.value)}
            placeholder="0.0" className="w-full bg-transparent border-0 p-0 text-2xl font-bold outline-none"
          />
        </div>

        <button onClick={fetchQuote} disabled={!amountIn || loading} className="btn-primary w-full">
          {loading ? "Finding best route..." : "Get Quote"}
        </button>
      </div>

      {quote && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-kaspa-gold" />
            <h3 className="font-display font-bold">Route</h3>
          </div>

          <div className="flex items-center justify-between mb-6">
            <div className="text-center">
              <p className="text-sm text-kaspa-muted">You sell</p>
              <p className="text-xl font-bold">{amountIn} {quote.token_in}</p>
            </div>
            <ArrowRight size={24} className="text-kaspa-pink" />
            <div className="text-center">
              <p className="text-sm text-kaspa-muted">You get</p>
              <p className="text-xl font-bold text-kaspa-green">
                {formatKaspa(quote.amount_out)} {quote.token_out}
              </p>
            </div>
          </div>

          {quote.route && quote.route.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-kaspa-muted font-medium uppercase tracking-wider">Route breakdown</p>
              {quote.route.map((step, i) => (
                <div key={i} className="glass rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-kaspa-purple/20 flex items-center justify-center text-xs font-bold text-kaspa-purple">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium">{step.pool_id}</span>
                    <span className="text-xs text-kaspa-muted">{step.type}</span>
                  </div>
                  <span className="text-xs font-mono">
                    {formatKaspa(step.amount_in)} → {formatKaspa(step.amount_out)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {quote.error && (
            <p className="text-center text-kaspa-red text-sm mt-4">{quote.error}</p>
          )}
        </motion.div>
      )}
    </div>
  )
}
