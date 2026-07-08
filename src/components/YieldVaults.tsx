import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { PiggyBank, TrendingUp, Plus, Minus, ArrowUpRight } from "lucide-react"
import { NETWORK } from "../utils/constants"
import { formatKaspa } from "../utils/kaspa"
import type { YieldVault } from "../types"

export default function YieldVaults() {
  const [vaults, setVaults] = useState<YieldVault[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVault, setSelectedVault] = useState<string | null>(null)
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit")
  const [amount, setAmount] = useState("")
  const [user] = useState("kaspa:testuser1")

  useEffect(() => {
    fetch(`${NETWORK.backend}/api/yield/vaults`)
      .then((r) => r.json())
      .then((d) => { setVaults(d.vaults); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const handleSubmit = async () => {
    if (!selectedVault || !amount) return
    const vault = vaults.find((v) => v.id === selectedVault)
    if (!vault) return

    const numAmount = Number(amount)
    const url = action === "deposit"
      ? `${NETWORK.backend}/api/yield/deposit?vault_id=${selectedVault}&amount=${numAmount}&depositor=${user}`
      : `${NETWORK.backend}/api/yield/withdraw?vault_id=${selectedVault}&shares=${numAmount / vault.price_per_share}&owner=${user}`

    await fetch(url, { method: "POST" })
    setAmount("")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Yield Vaults</h1>
        <p className="text-kaspa-muted text-sm mt-1">Deposit assets into automated yield strategies</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => <div key={i} className="glass rounded-2xl p-5 animate-shimmer h-36" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vaults.map((v) => (
            <motion.div
              key={v.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass rounded-2xl p-5 transition-all cursor-pointer ${
                selectedVault === v.id ? "border-kaspa-green/50 glow-purple" : "hover:border-kaspa-green/30"
              }`}
              onClick={() => { setSelectedVault(v.id); setAction("deposit") }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-kaspa-purple to-kaspa-pink flex items-center justify-center">
                    <PiggyBank size={18} />
                  </div>
                  <div>
                    <p className="font-display font-bold">{v.name}</p>
                    <p className="text-xs text-kaspa-muted">{v.token} vault</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-kaspa-green">{(v.apy || 5.2).toFixed(1)}% APY</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="glass rounded-xl p-2.5">
                  <p className="text-[10px] text-kaspa-muted">TVL</p>
                  <p className="text-sm font-bold">{formatKaspa(v.total_assets)}</p>
                </div>
                <div className="glass rounded-xl p-2.5">
                  <p className="text-[10px] text-kaspa-muted">Price/Share</p>
                  <p className="text-sm font-bold">{v.price_per_share.toFixed(4)}</p>
                </div>
                <div className="glass rounded-xl p-2.5">
                  <p className="text-[10px] text-kaspa-muted">Depositors</p>
                  <p className="text-sm font-bold">{v.total_supply.toFixed(0)}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selectedVault && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="glass rounded-2xl p-6 max-w-lg mx-auto"
          >
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setAction("deposit")}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                  action === "deposit" ? "bg-kaspa-green text-white" : "bg-white/5 text-kaspa-muted"
                }`}
              >
                <Plus size={14} className="inline mr-1" /> Deposit
              </button>
              <button
                onClick={() => setAction("withdraw")}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                  action === "withdraw" ? "bg-kaspa-pink text-white" : "bg-white/5 text-kaspa-muted"
                }`}
              >
                <Minus size={14} className="inline mr-1" /> Withdraw
              </button>
            </div>

            <div className="glass rounded-xl p-4 mb-4">
              <p className="text-sm text-kaspa-muted mb-2">
                {action === "deposit" ? "Amount to deposit" : "Shares to withdraw"}
              </p>
              <input
                type="text"
                value={amount}
                onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-transparent border-0 p-0 text-2xl font-bold outline-none"
              />
              {action === "withdraw" && amount && (
                <p className="text-xs text-kaspa-muted mt-1">
                  ≈ {(Number(amount) * (vaults.find((v) => v.id === selectedVault)?.price_per_share || 1)).toFixed(4)} assets
                </p>
              )}
            </div>

            <button onClick={handleSubmit} disabled={!amount || Number(amount) <= 0} className="btn-primary w-full">
              {action === "deposit" ? "Deposit" : "Withdraw"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
