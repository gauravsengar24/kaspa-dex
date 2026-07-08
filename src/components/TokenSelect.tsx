import { useState } from "react"
import { motion } from "framer-motion"
import { X, Search } from "lucide-react"
import { TOKENS, KASPA_TOKEN } from "../utils/constants"
import { formatKaspa } from "../utils/kaspa"
import type { TokenInfo } from "../types"

interface TokenSelectProps {
  onSelect: (token: TokenInfo) => void
  onClose: () => void
  krc20Balances?: Record<string, number>
  kasBalance?: string
}

export default function TokenSelect({ onSelect, onClose, krc20Balances = {}, kasBalance }: TokenSelectProps) {
  const [search, setSearch] = useState("")

  const filtered = search
    ? TOKENS.filter(
        (t) =>
          t.ticker.toLowerCase().includes(search.toLowerCase()) ||
          t.name.toLowerCase().includes(search.toLowerCase())
      )
    : TOKENS

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        className="relative glass-strong rounded-2xl w-full max-w-sm overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-kaspa-border/50">
          <h3 className="font-display font-bold text-lg">Select Token</h3>
          <button onClick={onClose} className="text-kaspa-muted hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2 glass rounded-xl px-3 py-2.5">
            <Search size={18} className="text-kaspa-muted" />
            <input
              type="text"
              placeholder="Search name or paste address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent border-0 outline-none flex-1 text-sm"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto px-2 pb-2">
          <div className="px-2 py-1.5 text-xs text-kaspa-muted font-medium">Popular tokens</div>
          {filtered.map((token) => (
            <button
              key={token.ticker}
              onClick={() => onSelect(token)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 transition-colors"
            >
              <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-lg">
                {token.icon}
              </span>
              <div className="text-left">
                <p className="font-semibold text-sm">{token.ticker}</p>
                <p className="text-xs text-kaspa-muted">{token.name}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-sm font-medium">
                  {token.isKrc20
                    ? krc20Balances[token.ticker] !== undefined
                      ? formatKaspa(krc20Balances[token.ticker])
                      : "—"
                    : kasBalance || "—"}
                </p>
                {token.isKrc20 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-kaspa-purple/20 text-kaspa-purple font-medium">
                    KRC-20
                  </span>
                )}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-kaspa-muted py-8 text-sm">No tokens found</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
