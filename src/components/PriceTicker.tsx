import { useState, useEffect } from "react"
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react"
import type { PriceData } from "../hooks/usePrices"
import { formatUsd } from "../utils/kaspa"

interface PriceTickerProps {
  prices: PriceData
  loading: boolean
  onRefresh: () => void
}

const tokens = ["NACHO", "KASPY", "GHOST", "KASPER"]

export default function PriceTicker({ prices, loading, onRefresh }: PriceTickerProps) {
  const [tickerIndex, setTickerIndex] = useState(0)
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimate(true)
      setTimeout(() => {
        setTickerIndex((i) => (i + 1) % (tokens.length + 1))
        setAnimate(false)
      }, 300)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const kas = prices.kas
  const hasChange = kas.change24h !== 0
  const changePositive = hasChange && kas.change24h > 0

  return (
    <div className="flex items-center gap-4 text-sm px-4 py-1.5 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-kaspa-muted text-xs font-medium uppercase tracking-wider">Live</span>
        <span className="w-1.5 h-1.5 rounded-full bg-kaspa-green animate-pulse" />
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <span className="font-display font-bold text-white shrink-0">KAS</span>
        <span className="font-mono font-medium">
          {kas.usd > 0 ? formatUsd(kas.usd) : "—"}
        </span>
        {kas.usd > 0 && hasChange && (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${changePositive ? "text-kaspa-green" : "text-kaspa-red"}`}>
            {changePositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(kas.change24h).toFixed(2)}%
          </span>
        )}
      </div>

      <div className="h-4 w-px bg-kaspa-border/40 shrink-0" />

      <div className="flex items-center gap-3 overflow-hidden relative flex-1">
        {!animate && (
          <div className="flex items-center gap-3 animate-slide-up shrink-0">
            {tickerIndex === 0 ? (
              <span className="text-kaspa-muted text-xs">KAS • {kas.usd > 0 ? formatUsd(kas.usd) : "—"}</span>
            ) : (
              (() => {
                const t = tokens[tickerIndex - 1]
                const tp = prices.tokens[t]
                if (!tp || tp.usd === 0) return <span className="text-kaspa-muted text-xs">{t} • —</span>
                return (
                  <span className="text-xs shrink-0">
                    <span className="text-white font-medium">{t}</span>
                    <span className="text-kaspa-muted ml-1">
                      {formatUsd(tp.usd)}
                    </span>
                    <span className="text-kaspa-muted ml-1.5">
                      {tp.kas < 0.0001 ? tp.kas.toExponential(2) : tp.kas.toFixed(6)} KAS
                    </span>
                  </span>
                )
              })()
            )}
          </div>
        )}
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="shrink-0 text-kaspa-muted hover:text-white transition-colors disabled:opacity-50"
        aria-label="Refresh prices"
      >
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
      </button>
    </div>
  )
}
