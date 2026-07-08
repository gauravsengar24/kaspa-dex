import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Vote, Lock, Scale, FileText, ThumbsUp, ThumbsDown, Gauge } from "lucide-react"
import { NETWORK } from "../utils/constants"
import type { GovernanceProposal, GaugeInfo } from "../types"

export default function Governance() {
  const [tab, setTab] = useState<"lock" | "proposals" | "gauges">("proposals")
  const [proposals, setProposals] = useState<GovernanceProposal[]>([])
  const [gauges, setGauges] = useState<GaugeInfo[]>([])
  const [lockAmount, setLockAmount] = useState("")
  const [lockDuration, setLockDuration] = useState(1)
  const [user] = useState("kaspa:testuser1")
  const [votingPower, setVotingPower] = useState(0)
  const [proposalTitle, setProposalTitle] = useState("")
  const [proposalDesc, setProposalDesc] = useState("")

  useEffect(() => {
    fetch(`${NETWORK.backend}/api/governance/proposals`)
      .then((r) => r.json()).then((d) => setProposals(d.proposals || [])).catch(() => {})
    fetch(`${NETWORK.backend}/api/governance/gauges`)
      .then((r) => r.json()).then((d) => setGauges(d.gauges || [])).catch(() => {})
    fetch(`${NETWORK.backend}/api/governance/voting-power/${user}`)
      .then((r) => r.json()).then((d) => setVotingPower(d.voting_power || 0)).catch(() => {})
  }, [])

  const handleLock = async () => {
    if (!lockAmount) return
    await fetch(
      `${NETWORK.backend}/api/governance/lock?user=${user}&amount=${lockAmount}&duration_years=${lockDuration}`,
      { method: "POST" }
    )
    setLockAmount("")
  }

  const handlePropose = async () => {
    if (!proposalTitle) return
    await fetch(
      `${NETWORK.backend}/api/governance/proposals?title=${encodeURIComponent(proposalTitle)}&description=${encodeURIComponent(proposalDesc)}&proposer=${user}`,
      { method: "POST" }
    )
    setProposalTitle("")
    setProposalDesc("")
  }

  const handleVote = async (pid: string, support: string) => {
    await fetch(`${NETWORK.backend}/api/governance/proposals/${pid}/vote?voter=${user}&support=${support}`, { method: "POST" })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Governance</h1>
          <p className="text-kaspa-muted text-sm mt-1">Lock KAS, vote on proposals, direct emissions</p>
        </div>
        <div className="glass rounded-xl px-4 py-2 text-center">
          <p className="text-xs text-kaspa-muted">veKASPA Power</p>
          <p className="font-bold text-kaspa-pink">{votingPower.toFixed(2)}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {([
          { id: "lock" as const, label: "Lock KAS", icon: Lock },
          { id: "proposals" as const, label: "Proposals", icon: FileText },
          { id: "gauges" as const, label: "Gauges", icon: Gauge },
        ]).map((t) => (
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

      {tab === "lock" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-2xl p-6 max-w-lg mx-auto">
          <h3 className="font-display font-bold text-lg mb-2">Lock KAS for veKASPA</h3>
          <p className="text-sm text-kaspa-muted mb-4">Lock up to 4 years for maximum voting power</p>
          <div className="glass rounded-xl p-4 mb-4">
            <p className="text-sm text-kaspa-muted mb-2">Amount to lock</p>
            <input
              type="text" value={lockAmount}
              onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setLockAmount(e.target.value)}
              placeholder="0.0" className="w-full bg-transparent border-0 p-0 text-2xl font-bold outline-none"
            />
          </div>
          <div className="flex gap-2 mb-4">
            {[1, 2, 3, 4].map((y) => (
              <button
                key={y}
                onClick={() => setLockDuration(y)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                  lockDuration === y ? "bg-kaspa-purple text-white" : "glass text-kaspa-muted"
                }`}
              >
                {y}yr
              </button>
            ))}
          </div>
          {lockAmount && (
            <p className="text-center text-sm text-kaspa-muted mb-4">
              Estimated veKASPA: {(Number(lockAmount) * (lockDuration / 4)).toFixed(2)}
            </p>
          )}
          <button onClick={handleLock} disabled={!lockAmount} className="btn-primary w-full">Lock KAS</button>
        </motion.div>
      )}

      {tab === "proposals" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="glass rounded-2xl p-5">
            <h3 className="font-display font-bold mb-3">Create Proposal</h3>
            <div className="space-y-3">
              <input
                type="text" value={proposalTitle}
                onChange={(e) => setProposalTitle(e.target.value)}
                placeholder="Proposal title" className="w-full glass rounded-xl p-3 text-sm outline-none"
              />
              <textarea
                value={proposalDesc}
                onChange={(e) => setProposalDesc(e.target.value)}
                placeholder="Proposal description" rows={3}
                className="w-full glass rounded-xl p-3 text-sm outline-none resize-none"
              />
              <button onClick={handlePropose} disabled={!proposalTitle} className="btn-primary w-full">
                Submit Proposal
              </button>
            </div>
          </div>

          {proposals.length === 0 ? (
            <p className="text-center text-kaspa-muted py-8">No active proposals</p>
          ) : (
            proposals.map((p) => {
              const total = p.for_votes + p.against_votes + p.abstain_votes
              const forPct = total > 0 ? (p.for_votes / total) * 100 : 0
              return (
                <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="glass rounded-2xl p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-display font-bold">{p.title}</h3>
                      <p className="text-xs text-kaspa-muted mt-1">by {p.proposer.slice(0, 10)}...</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      p.status === "active" ? "bg-kaspa-green/10 text-kaspa-green" : "bg-kaspa-muted/10 text-kaspa-muted"
                    }`}>{p.status}</span>
                  </div>
                  <p className="text-sm text-kaspa-muted mb-3 line-clamp-2">{p.description}</p>
                  <div className="w-full h-2 rounded-full bg-white/5 mb-3 overflow-hidden">
                    <div className="h-full bg-kaspa-green rounded-full" style={{ width: `${forPct}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleVote(p.id, "for")}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-kaspa-green/10 text-kaspa-green hover:bg-kaspa-green/20 transition-all"
                      ><ThumbsUp size={14} /> {p.for_votes.toFixed(0)}</button>
                      <button onClick={() => handleVote(p.id, "against")}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-kaspa-red/10 text-kaspa-red hover:bg-kaspa-red/20 transition-all"
                      ><ThumbsDown size={14} /> {p.against_votes.toFixed(0)}</button>
                    </div>
                    <span className="text-xs text-kaspa-muted">{forPct.toFixed(1)}% For</span>
                  </div>
                </motion.div>
              )
            })
          )}
        </motion.div>
      )}

      {tab === "gauges" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          {gauges.length === 0 ? (
            <p className="text-center text-kaspa-muted py-8">No gauges available</p>
          ) : (
            gauges.map((g) => (
              <motion.div key={g.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl p-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-display font-bold">{g.name}</p>
                  <p className="text-xs text-kaspa-muted">{g.pool_type}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-bold">{(g.relative_weight * 100).toFixed(1)}%</p>
                    <p className="text-[10px] text-kaspa-muted">weight</p>
                  </div>
                  <button onClick={async () => {
                    await fetch(`${NETWORK.backend}/api/governance/gauges/vote?voter=${user}&gauge_id=${g.id}&weight_bps=100`, { method: "POST" })
                  }} className="btn-secondary text-xs py-1.5 px-3">Vote</button>
                </div>
              </motion.div>
            ))
          )}
        </motion.div>
      )}
    </div>
  )
}
