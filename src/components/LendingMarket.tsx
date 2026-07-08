import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Landmark, ArrowUpRight, ArrowDownRight, AlertTriangle, TrendingUp, Coins } from "lucide-react"
import { NETWORK } from "../utils/constants"
import { formatKaspa, formatUsd } from "../utils/kaspa"
import type { LendingMarket as LendingMarketType } from "../types"

type ActionType = "supply" | "borrow" | "repay"

export default function LendingMarket() {
  const [markets, setMarkets] = useState<LendingMarketType[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<ActionType>("supply")
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [user, setUser] = useState("kaspa:testuser1")

  useEffect(() => {
    fetch(`${NETWORK.backend}/api/lending/markets`)
      .then((r) => r.json())
      .then((d) => { setMarkets(d.markets); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const handleSubmit = async () => {
    if (!selectedMarket || !amount) return
    const endpoint = action === "supply" ? "supply" : action === "borrow" ? "borrow" : "repay"
    const params = new URLSearchParams({ user, market_id: selectedMarket, amount })
    if (action === "borrow") params.append("collateral_market", selectedMarket)
    await fetch(`${NETWORK.backend}/api/lending/${endpoint}?${params}`, { method: "POST" })
    setAmount("")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Lending</h1>
          <p className="text-kaspa-muted text-sm mt-1">Supply assets and borrow against collateral</p>
        </div>
        <div className="flex gap-2">
          {(["supply", "borrow", "repay"] as ActionType[]).map((a) => (
            <button
              key={a}
              onClick={() => { setAction(a); setSelectedMarket(null) }}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                action === a ? "bg-kaspa-pink text-white" : "glass text-kaspa-muted hover:text-white"
              }`}
            >
              {a === "supply" ? "Supply" : a === "borrow" ? "Borrow" : "Repay"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass rounded-2xl p-5 animate-shimmer h-48" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass rounded-2xl p-5 transition-all cursor-pointer ${
                selectedMarket === m.id ? "border-kaspa-pink/50 glow-pink" : "hover:border-kaspa-pink/30"
              }`}
              onClick={() => setSelectedMarket(m.id)}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-kaspa-green to-kaspa-purple flex items-center justify-center">
                    <Landmark size={18} />
                  </div>
                  <div>
                    <p className="font-display font-bold">{m.token}</p>
                    <p className="text-xs text-kaspa-muted">LTV: {(m.ltv * 100).toFixed(0)}%</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  m.utilization > 0.8 ? "bg-kaspa-red/10 text-kaspa-red" : "bg-kaspa-green/10 text-kaspa-green"
                }`}>
                  {(m.utilization * 100).toFixed(1)}% utilized
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="glass rounded-xl p-3">
                  <p className="text-[10px] text-kaspa-muted uppercase tracking-wider">Supply APR</p>
                  <p className="text-lg font-bold text-kaspa-green">{(m.supply_apr * 100).toFixed(2)}%</p>
                </div>
                <div className="glass rounded-xl p-3">
                  <p className="text-[10px] text-kaspa-muted uppercase tracking-wider">Borrow APR</p>
                  <p className="text-lg font-bold text-kaspa-red">{(m.borrow_apr * 100).toFixed(2)}%</p>
                </div>
              </div>

              <div className="flex justify-between text-xs text-kaspa-muted mb-1">
                <span>Total Supply: {formatKaspa(m.total_supply)}</span>
                <span>Borrow: {formatKaspa(m.total_borrow)}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selectedMarket && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="glass rounded-2xl p-6"
          >
            <h3 className="font-display font-bold text-lg mb-4 capitalize">{action} {selectedMarket}</h3>
            <div className="glass rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-kaspa-muted">Amount ({selectedMarket.split("-")[0].toUpperCase()})</span>
              </div>
              <input
                type="text"
                value={amount}
                onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-transparent border-0 p-0 text-2xl font-bold outline-none"
              />
            </div>
            <button
              onClick={handleSubmit}
              disabled={!amount || Number(amount) <= 0}
              className="btn-primary w-full"
            >
              {action === "supply" ? "Supply" : action === "borrow" ? "Borrow" : "Repay"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
