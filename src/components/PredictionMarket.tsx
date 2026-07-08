import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Trophy, Clock, History } from "lucide-react"
import { NETWORK } from "../utils/constants"
import { formatKaspa } from "../utils/kaspa"
import type { PredictionRound } from "../types"

export default function PredictionMarket() {
  const [round, setRound] = useState<any>(null)
  const [history, setHistory] = useState<PredictionRound[]>([])
  const [loading, setLoading] = useState(true)
  const [betAmount, setBetAmount] = useState("")
  const [user] = useState("kaspa:testuser1")
  const [direction, setDirection] = useState<"UP" | "DOWN">("UP")

  const fetchState = () => {
    fetch(`${NETWORK.backend}/api/prediction/state`)
      .then((r) => r.json())
      .then((d) => { setRound(d); setLoading(false) })
      .catch(() => setLoading(false))
    fetch(`${NETWORK.backend}/api/prediction/history`)
      .then((r) => r.json())
      .then((d) => setHistory(d.rounds || []))
      .catch(() => {})
  }

  useEffect(() => { fetchState(); const i = setInterval(fetchState, 10000); return () => clearInterval(i) }, [])

  const placeBet = async () => {
    if (!betAmount) return
    await fetch(`${NETWORK.backend}/api/prediction/bet?user=${user}&amount=${betAmount}&direction=${direction}`, { method: "POST" })
    setBetAmount("")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Prediction Market</h1>
        <p className="text-kaspa-muted text-sm mt-1">Predict KAS price direction and win prizes</p>
      </div>

      {loading ? (
        <div className="glass rounded-2xl p-8 animate-shimmer h-64" />
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass rounded-2xl p-6 text-center"
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <Trophy size={20} className="text-kaspa-gold" />
              <span className="text-sm text-kaspa-muted font-medium">Round #{round?.active_round?.round_number || 1}</span>
            </div>
            <p className="text-3xl font-bold font-mono mb-1">
              {round?.active_round?.lock_price ? round.active_round.lock_price.toFixed(6) : "—"}
            </p>
            <p className="text-sm text-kaspa-muted mb-4">Locked Price</p>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="glass rounded-xl p-4">
                <TrendingUp size={24} className="text-kaspa-green mx-auto mb-1" />
                <p className="text-lg font-bold text-kaspa-green">{round?.active_round?.total_bets_up || 0}</p>
                <p className="text-xs text-kaspa-muted">UP bets</p>
              </div>
              <div className="glass rounded-xl p-4">
                <TrendingDown size={24} className="text-kaspa-red mx-auto mb-1" />
                <p className="text-lg font-bold text-kaspa-red">{round?.active_round?.total_bets_down || 0}</p>
                <p className="text-xs text-kaspa-muted">DOWN bets</p>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setDirection("UP")}
                className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${
                  direction === "UP" ? "bg-kaspa-green text-white shadow-lg" : "glass text-kaspa-muted"
                }`}
              >
                🚀 UP
              </button>
              <button
                onClick={() => setDirection("DOWN")}
                className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${
                  direction === "DOWN" ? "bg-kaspa-red text-white shadow-lg" : "glass text-kaspa-muted"
                }`}
              >
                💀 DOWN
              </button>
            </div>

            <div className="glass rounded-xl p-4 mb-4">
              <input
                type="text"
                value={betAmount}
                onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setBetAmount(e.target.value)}
                placeholder="Bet amount (KAS)"
                className="w-full bg-transparent border-0 p-0 text-xl font-bold text-center outline-none"
              />
            </div>

            <button onClick={placeBet} disabled={!betAmount || Number(betAmount) <= 0} className="btn-primary w-full">
              Place {direction} Bet
            </button>
          </motion.div>

          {history.length > 0 && (
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <History size={16} className="text-kaspa-muted" />
                <h3 className="font-display font-bold">Recent Rounds</h3>
              </div>
              <div className="space-y-2">
                {history.slice(0, 10).map((r) => (
                  <div key={r.round_number} className="flex items-center justify-between text-sm glass rounded-xl p-3">
                    <span className="text-kaspa-muted">#{r.round_number}</span>
                    <span className={r.result_direction === "UP" ? "text-kaspa-green" : "text-kaspa-red"}>
                      {r.settled ? (r.result_direction === "UP" ? "🚀" : "💀") : "⏳"}
                    </span>
                    <span className="font-mono text-xs">{r.lock_price?.toFixed(6) || "—"}</span>
                    <span className="font-mono text-xs">{r.result_price?.toFixed(6) || "—"}</span>
                    <span className="text-kaspa-muted">{r.total_bets} bets</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
