import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { TrendingUp, TrendingDown, Zap, X, ArrowUpRight, ArrowDownRight, Percent } from "lucide-react"
import { NETWORK } from "../utils/constants"

export default function PerpFutures() {
  const [side, setSide] = useState<"long" | "short">("long")
  const [leverage, setLeverage] = useState(5)
  const [size, setSize] = useState("")
  const [user] = useState("kaspa:testuser1")
  const [position, setPosition] = useState<any>(null)
  const [account, setAccount] = useState<any>(null)
  const [pnl, setPnl] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const fetchState = async () => {
    const [posRes, acctRes] = await Promise.all([
      fetch(`${NETWORK.backend}/api/perp/position?user=${user}`),
      fetch(`${NETWORK.backend}/api/perp/account?user=${user}&current_price=0.0295`),
    ])
    const posData = await posRes.json()
    const acctData = await acctRes.json()
    setPosition(posData.position || null)
    setAccount(acctData)
  }

  const openPosition = async () => {
    if (!size) return
    setLoading(true)
    const res = await fetch(
      `${NETWORK.backend}/api/perp/open?user=${user}&side=${side}&size=${size}&leverage=${leverage}&current_price=0.0295`,
      { method: "POST" }
    )
    const data = await res.json()
    if (!data.error) {
      await fetchState()
      setSize("")
    }
    setLoading(false)
  }

  const closePosition = async () => {
    setLoading(true)
    const res = await fetch(
      `${NETWORK.backend}/api/perp/close?user=${user}&current_price=0.0295`,
      { method: "POST" }
    )
    const data = await res.json()
    setPnl(data)
    setPosition(null)
    await fetchState()
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Perpetual Futures</h1>
          <p className="text-kaspa-muted text-sm mt-1">Trade KAS with up to 50x leverage</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="glass rounded-2xl p-5">
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setSide("long")}
                className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${
                  side === "long" ? "bg-kaspa-green text-white shadow-lg" : "glass text-kaspa-muted"
                }`}
              >
                <TrendingUp size={18} className="inline mr-1" /> Long
              </button>
              <button
                onClick={() => setSide("short")}
                className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${
                  side === "short" ? "bg-kaspa-red text-white shadow-lg" : "glass text-kaspa-muted"
                }`}
              >
                <TrendingDown size={18} className="inline mr-1" /> Short
              </button>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-kaspa-muted">Leverage</span>
                <span className="text-lg font-bold">{leverage}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="50"
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full accent-kaspa-pink"
              />
              <div className="flex justify-between text-[10px] text-kaspa-muted mt-1">
                <span>1x</span><span>10x</span><span>25x</span><span>50x</span>
              </div>
            </div>

            <div className="glass rounded-xl p-4 mb-4">
              <p className="text-xs text-kaspa-muted mb-2">Position Size (USD)</p>
              <input
                type="text"
                value={size}
                onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setSize(e.target.value)}
                placeholder="0.0"
                className="w-full bg-transparent border-0 p-0 text-2xl font-bold outline-none"
              />
            </div>

            {size && (
              <div className="glass rounded-xl p-3 text-sm space-y-1.5 mb-4">
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Entry price</span>
                  <span className="font-mono">$0.0295</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Margin required</span>
                  <span className="font-mono">${(Number(size) / leverage).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Liquidation price ({side === "long" ? "↓" : "↑"})</span>
                  <span className="font-mono text-kaspa-red">
                    ${(side === "long" ? 0.0295 * (1 - 0.995 / leverage) : 0.0295 * (1 + 0.995 / leverage)).toFixed(6)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Funding rate</span>
                   <span className="text-kaspa-green font-mono">0.01%</span>
                </div>
              </div>
            )}

            <button
              onClick={openPosition}
              disabled={!size || loading}
              className={`w-full py-3 rounded-xl font-bold text-base transition-all ${
                side === "long"
                  ? "bg-kaspa-green text-white hover:opacity-90"
                  : "bg-kaspa-red text-white hover:opacity-90"
              } disabled:opacity-50`}
            >
              {loading ? "Processing..." : `${side === "long" ? "Long" : "Short"} ${size || "0.0"} USD`}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-4">
            <h3 className="font-display font-bold text-sm mb-3">Account</h3>
            {account ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Wallet</span>
                  <span className="font-mono">${account.wallet_balance?.toFixed(2) || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Equity</span>
                  <span className="font-mono">${account.equity?.toFixed(2) || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Free margin</span>
                  <span className="font-mono text-kaspa-green">${account.free_margin?.toFixed(2) || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Unrealized PnL</span>
                  <span className={`font-mono ${(account.unrealized_pnl || 0) >= 0 ? "text-kaspa-green" : "text-kaspa-red"}`}>
                    ${account.unrealized_pnl?.toFixed(2) || "0.00"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-kaspa-muted">Connect to trade</p>
            )}
          </div>

          <div className="glass rounded-2xl p-4">
            <h3 className="font-display font-bold text-sm mb-3">
              {position ? "Position" : "No Position"}
            </h3>
            {position ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    position.side === "long" ? "bg-kaspa-green/20 text-kaspa-green" : "bg-kaspa-red/20 text-kaspa-red"
                  }`}>
                    {position.side.toUpperCase()}
                  </span>
                  <span className="font-bold">{position.leverage}x</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Size</span>
                  <span className="font-mono">{position.size} USD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Entry</span>
                  <span className="font-mono">${position.entry_price?.toFixed(6)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaspa-muted">Liq. price</span>
                  <span className="font-mono text-kaspa-red">${position.liquidation_price?.toFixed(6)}</span>
                </div>
                <button
                  onClick={closePosition}
                  disabled={loading}
                  className="w-full mt-3 py-2 rounded-xl bg-kaspa-red/20 text-kaspa-red text-sm font-bold hover:bg-kaspa-red/30 transition-all"
                >
                  Close Position
                </button>
              </div>
            ) : (
              <div className="text-center py-4">
                <Zap size={24} className="mx-auto text-kaspa-muted mb-1" />
                <p className="text-xs text-kaspa-muted">Open a position to get started</p>
              </div>
            )}
          </div>

          <AnimatePresence>
            {pnl && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={`glass rounded-2xl p-4 text-center ${pnl.pnl >= 0 ? "border-kaspa-green/30" : "border-kaspa-red/30"}`}
              >
                <p className="text-xs text-kaspa-muted mb-1">Position Closed</p>
                <p className={`text-2xl font-bold ${pnl.pnl >= 0 ? "text-kaspa-green" : "text-kaspa-red"}`}>
                  {pnl.pnl >= 0 ? "+" : ""}${pnl.pnl?.toFixed(2)}
                </p>
                <p className="text-sm text-kaspa-muted">
                  {pnl.pnl_pct?.toFixed(2)}% ({pnl.direction})
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
