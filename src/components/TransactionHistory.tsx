import { motion } from "framer-motion"
import { ArrowRightLeft, CheckCircle, Clock, XCircle, ExternalLink } from "lucide-react"
import type { Transaction } from "../types"
import { NETWORK } from "../utils/constants"

interface TransactionHistoryProps {
  compact?: boolean
}

const mockTxs: Transaction[] = [
  { id: "1", type: "swap", fromToken: "KAS", toToken: "NACHO", fromAmount: "500", toAmount: "125000", timestamp: Date.now() - 60000, status: "confirmed", txHash: "abc123..." },
  { id: "2", type: "swap", fromToken: "NACHO", toToken: "KAS", fromAmount: "50000", toAmount: "185", timestamp: Date.now() - 300000, status: "confirmed", txHash: "def456..." },
  { id: "3", type: "swap", fromToken: "KAS", toToken: "KASPY", fromAmount: "1000", toAmount: "55000", timestamp: Date.now() - 900000, status: "pending" },
  { id: "4", type: "addLiquidity", fromToken: "KAS", toToken: "NACHO", fromAmount: "250", toAmount: "62500", timestamp: Date.now() - 3600000, status: "confirmed", txHash: "ghi789..." },
  { id: "5", type: "swap", fromToken: "KASPY", toToken: "KAS", fromAmount: "10000", toAmount: "175", timestamp: Date.now() - 7200000, status: "failed" },
]

const displayTxs = mockTxs

const statusIcons = {
  confirmed: CheckCircle,
  pending: Clock,
  failed: XCircle,
}

const statusColors = {
  confirmed: "text-kaspa-green",
  pending: "text-kaspa-gold",
  failed: "text-kaspa-red",
}

export default function TransactionHistory({ compact = false }: TransactionHistoryProps) {
  const txs = compact ? displayTxs.slice(0, 3) : displayTxs

  return (
    <div className="glass rounded-2xl">
      <div className="p-3 border-b border-kaspa-border/50">
        <h3 className="font-display font-bold text-sm">
          {compact ? "Recent Transactions" : "Transaction History"}
        </h3>
      </div>

      <div className={`${compact ? "max-h-48" : ""} overflow-y-auto`}>
        {txs.length === 0 ? (
          <div className="p-8 text-center">
            <ArrowRightLeft size={24} className="mx-auto text-kaspa-muted mb-2" />
            <p className="text-sm text-kaspa-muted">No transactions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-kaspa-border/30">
            {txs.map((tx, i) => {
              const StatusIcon = statusIcons[tx.status]
              const statusColor = statusColors[tx.status]
              return (
                <motion.div
                  key={tx.id}
                  initial={compact ? undefined : { opacity: 0, y: 8 }}
                  animate={compact ? undefined : { opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 p-3 hover:bg-white/5 transition-colors"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    tx.type === "addLiquidity" ? "bg-kaspa-purple/20" : "bg-white/10"
                  }`}>
                    <ArrowRightLeft size={14} className="text-kaspa-muted" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      Swap {tx.fromAmount} {tx.fromToken} → {tx.toAmount} {tx.toToken}
                    </p>
                    <p className="text-xs text-kaspa-muted">
                      {new Date(tx.timestamp).toLocaleTimeString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`flex items-center gap-1 text-xs ${statusColor}`}>
                      <StatusIcon size={12} />
                      {tx.status === "pending" ? "Pending" : tx.status === "confirmed" ? "Success" : "Failed"}
                    </span>
                    {tx.txHash && (
                      <a
                        href={`${NETWORK.explorer}/${tx.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-kaspa-muted hover:text-white"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
