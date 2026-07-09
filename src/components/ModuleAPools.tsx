import { motion } from "framer-motion"
import { PieChart, Layers, Weight, DollarSign } from "lucide-react"
import { useModuleAPools } from "../hooks/useModuleAPools"
import type { ModuleAPoolInfo } from "../types"

function PoolTokenBar({ tokens }: { tokens: ModuleAPoolInfo["tokens"] }) {
  const colors = ["from-kaspa-pink to-kaspa-purple", "from-kaspa-gold to-kaspa-red", "from-kaspa-cyan to-kaspa-blue", "from-kaspa-green to-kaspa-teal"]
  return (
    <div className="w-full h-2 rounded-full bg-white/5 flex overflow-hidden">
      {tokens.map((t, i) => (
        <div
          key={t.ticker}
          className={`h-full bg-gradient-to-r ${colors[i % colors.length]}`}
          style={{ width: `${t.weight * 100}%` }}
        />
      ))}
    </div>
  )
}

function PoolCard({ pool }: { pool: ModuleAPoolInfo }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 hover:border-kaspa-pink/30 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-kaspa-pink" />
          <span className="font-display font-bold">{pool.tokens.length}-Token Weighted Pool</span>
        </div>
        <span className="text-xs bg-kaspa-green/10 text-kaspa-green px-2 py-1 rounded-full font-medium">
          {pool.swapFee * 100}% fee
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-kaspa-muted flex items-center gap-1">
            <Weight size={14} /> Weights
          </span>
          <span className="flex gap-3">
            {pool.tokens.map((t) => (
              <span key={t.ticker} className="font-medium">{(t.weight * 100).toFixed(0)}% {t.ticker}</span>
            ))}
          </span>
        </div>
        <PoolTokenBar tokens={pool.tokens} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-kaspa-muted uppercase tracking-wider font-medium mb-1">TVL</p>
          <p className="text-sm font-bold">${pool.tvl.toFixed(2)}</p>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-kaspa-muted uppercase tracking-wider font-medium mb-1">Supply</p>
          <p className="text-sm font-bold">{Number(pool.totalSupply).toFixed(4)}</p>
        </div>
      </div>

      <div className="space-y-2">
        {pool.tokens.map((t) => (
          <div key={t.ticker} className="flex items-center justify-between text-xs glass rounded-lg px-3 py-2">
            <span className="text-kaspa-muted">{t.ticker}</span>
            <span className="font-mono font-medium">{Number(t.balance).toFixed(4)}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

export default function ModuleAPools() {
  const { pools, loading } = useModuleAPools()

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <PieChart size={24} className="text-kaspa-pink" />
            Module A - Weighted Pools
          </h1>
          <p className="text-kaspa-muted text-sm mt-1">Multi-asset pools with configurable weights. Balancer-style AMM.</p>
        </div>
      </div>
      {loading ? (
        <div className="text-center text-kaspa-muted py-12">Loading pools...</div>
      ) : pools.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Layers size={48} className="mx-auto text-kaspa-muted mb-4" />
          <p className="text-kaspa-muted">No weighted pools deployed yet.</p>
          <p className="text-xs text-kaspa-muted mt-1">Deploy Module A contracts to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pools.map((pool) => (
            <PoolCard key={pool.poolAddress} pool={pool} />
          ))}
        </div>
      )}
    </div>
  )
}
