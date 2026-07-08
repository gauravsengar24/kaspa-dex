import { motion } from "framer-motion"
import { Plus, Minus, TrendingUp, Droplets } from "lucide-react"
import type { PoolInfo } from "../types"
import { formatKaspa } from "../utils/kaspa"

interface PoolCardProps {
  pool: PoolInfo
}

export default function PoolCard({ pool }: PoolCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl p-5 hover:border-kaspa-pink/30 transition-all group"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center text-sm font-bold border-2 border-kaspa-dark relative z-10">
              {pool.token0.slice(0, 2)}
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-kaspa-gold to-kaspa-red flex items-center justify-center text-sm font-bold border-2 border-kaspa-dark">
              {pool.token1.slice(0, 2)}
            </div>
          </div>
          <div>
            <p className="font-display font-bold">
              {pool.token0} / {pool.token1}
            </p>
            <p className="text-xs text-kaspa-muted">{pool.fee}% fee tier</p>
          </div>
        </div>
        <span className="text-xs bg-kaspa-green/10 text-kaspa-green px-2 py-1 rounded-full font-medium">
          Active
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-kaspa-muted uppercase tracking-wider font-medium mb-1">TVL</p>
          <p className="text-sm font-bold">${formatKaspa(pool.tvl)}</p>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-kaspa-muted uppercase tracking-wider font-medium mb-1">Volume 24h</p>
          <p className="text-sm font-bold">${formatKaspa(pool.volume24h)}</p>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-kaspa-muted uppercase tracking-wider font-medium mb-1">APR</p>
          <p className="text-sm font-bold text-kaspa-green">{pool.apr.toFixed(1)}%</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 glass rounded-xl p-2.5">
          <p className="text-[10px] text-kaspa-muted mb-0.5">{pool.token0} Reserves</p>
          <p className="text-xs font-mono font-medium">{Number(pool.reserve0).toLocaleString()}</p>
        </div>
        <div className="flex items-center justify-center text-kaspa-muted">
          <TrendingUp size={14} />
        </div>
        <div className="flex-1 glass rounded-xl p-2.5">
          <p className="text-[10px] text-kaspa-muted mb-0.5">{pool.token1} Reserves</p>
          <p className="text-xs font-mono font-medium">{Number(pool.reserve1).toLocaleString()}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="flex-1 btn-primary py-2.5 text-sm flex items-center justify-center gap-1.5">
          <Plus size={14} />
          Add
        </button>
        <button className="flex-1 btn-secondary py-2.5 text-sm flex items-center justify-center gap-1.5">
          <Minus size={14} />
          Remove
        </button>
      </div>
    </motion.div>
  )
}
