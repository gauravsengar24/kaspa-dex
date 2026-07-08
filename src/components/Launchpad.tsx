import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Rocket, Gavel, Timer, Lock, ArrowUpRight, Coins } from "lucide-react"
import { NETWORK } from "../utils/constants"
import { formatKaspa } from "../utils/kaspa"
import type { IFOState, LBPState, DutchAuctionState } from "../types"

type LaunchTab = "ifo" | "lbp" | "dutch"

export default function Launchpad() {
  const [tab, setTab] = useState<LaunchTab>("ifo")
  const [ifos, setIfos] = useState<IFOState[]>([])
  const [lbps, setLbps] = useState<LBPState[]>([])
  const [auctions, setAuctions] = useState<DutchAuctionState[]>([])
  const [loading, setLoading] = useState(true)
  const [commitAmount, setCommitAmount] = useState("")
  const [activeIfo, setActiveIfo] = useState<string | null>(null)
  const [user] = useState("kaspa:testuser1")

  const tabs: { id: LaunchTab; label: string; icon: any }[] = [
    { id: "ifo", label: "IFO", icon: Rocket },
    { id: "lbp", label: "LBP", icon: Gavel },
    { id: "dutch", label: "Dutch Auction", icon: Timer },
  ]

  useEffect(() => {
    Promise.all([
      fetch(`${NETWORK.backend}/api/launchpad/ifos`).then((r) => r.json()),
      fetch(`${NETWORK.backend}/api/launchpad/lbp`).then((r) => r.json()),
      fetch(`${NETWORK.backend}/api/launchpad/dutch`).then((r) => r.json()),
    ]).then(([ifoData, lbpData, auctionData]) => {
      setIfos(ifoData.ifos || [])
      setLbps(lbpData.lbps || [])
      setAuctions(auctionData.auctions || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleCommit = async () => {
    if (!activeIfo || !commitAmount) return
    await fetch(`${NETWORK.backend}/api/launchpad/ifo/commit?ifo_id=${activeIfo}&user=${user}&amount=${commitAmount}`, { method: "POST" })
    setCommitAmount("")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Launchpad</h1>
        <p className="text-kaspa-muted text-sm mt-1">Participate in token launches and sales</p>
      </div>

      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              tab === t.id ? "bg-kaspa-pink text-white" : "glass text-kaspa-muted hover:text-white"
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="glass rounded-2xl p-8 animate-shimmer h-48" />
      ) : tab === "ifo" && (
        <div className="space-y-4">
          {ifos.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center">
              <Rocket size={32} className="mx-auto text-kaspa-muted mb-2" />
              <p className="text-kaspa-muted">No active IFOs</p>
            </div>
          ) : (
            ifos.map((ifo) => (
              <motion.div key={ifo.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl p-5"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-kaspa-pink to-kaspa-gold flex items-center justify-center">
                      <Coins size={18} />
                    </div>
                    <div>
                      <p className="font-display font-bold">{ifo.token} IFO</p>
                      <p className="text-xs text-kaspa-muted">Base: {ifo.base_token}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    ifo.state === "public" ? "bg-kaspa-green/10 text-kaspa-green" : "bg-kaspa-gold/10 text-kaspa-gold"
                  }`}>{ifo.state}</span>
                </div>
                <div className="flex justify-between text-sm mb-4">
                  <span className="text-kaspa-muted">Total tokens: {formatKaspa(ifo.token_amount)}</span>
                  <span className="text-kaspa-muted">Committed: {formatKaspa(ifo.total_committed)} KAS</span>
                  <span className="text-kaspa-muted">{ifo.participants} participants</span>
                </div>
                <button onClick={() => setActiveIfo(activeIfo === ifo.id ? null : ifo.id)}
                  className="btn-primary w-full">
                  {activeIfo === ifo.id ? "Cancel" : "Participate"}
                </button>

                <AnimatePresence>
                  {activeIfo === ifo.id && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }} className="overflow-hidden mt-3">
                      <div className="glass rounded-xl p-4 mb-3">
                        <input type="text" value={commitAmount}
                          onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setCommitAmount(e.target.value)}
                          placeholder="Commit KAS" className="w-full bg-transparent border-0 p-0 text-xl font-bold text-center outline-none"
                        />
                      </div>
                      <button onClick={handleCommit} disabled={!commitAmount}
                        className="btn-primary w-full">Commit</button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))
          )}
        </div>
      )}

      {tab === "lbp" && (
        <div className="space-y-4">
          {lbps.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center">
              <Gavel size={32} className="mx-auto text-kaspa-muted mb-2" />
              <p className="text-kaspa-muted">No active LBP launches</p>
            </div>
          ) : (
            lbps.map((lbp) => (
              <motion.div key={lbp.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-display font-bold">{lbp.project_token} LBP</p>
                    <p className="text-xs text-kaspa-muted">{lbp.base_token} pair</p>
                  </div>
                  <span className="text-lg font-bold text-kaspa-green">{lbp.current_price.toFixed(6)} KAS</span>
                </div>
                <div className="flex justify-between text-sm text-kaspa-muted">
                  <span>Supply: {formatKaspa(lbp.project_amount)}</span>
                  <span>Raised: {formatKaspa(lbp.base_amount)} KAS</span>
                  <span className="capitalize">{lbp.state}</span>
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}

      {tab === "dutch" && (
        <div className="space-y-4">
          {auctions.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center">
              <Timer size={32} className="mx-auto text-kaspa-muted mb-2" />
              <p className="text-kaspa-muted">No active Dutch auctions</p>
            </div>
          ) : (
            auctions.map((a) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-display font-bold">{a.token} Auction</p>
                    <p className="text-xs text-kaspa-muted">Declining price</p>
                  </div>
                  <span className="text-lg font-bold text-kaspa-pink">{a.current_price.toFixed(6)} KAS</span>
                </div>
                <div className="flex justify-between text-sm text-kaspa-muted">
                  <span>Start: {a.start_price.toFixed(4)} KAS</span>
                  <span>End: {a.end_price.toFixed(4)} KAS</span>
                  <span>Supply: {formatKaspa(a.token_amount)}</span>
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
