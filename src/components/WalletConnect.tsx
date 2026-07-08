import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Wallet,
  X,
  Copy,
  Check,
  ExternalLink,
  LogOut,
  Download,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import { formatAddress } from "../utils/kaspa"

interface WalletConnectProps {
  connected: boolean
  address: string
  balance: string
  connecting: boolean
  detecting: boolean
  kaswareDetected: boolean
  error: string | null
  onConnect: () => Promise<void>
  onDisconnect: () => void
}

export default function WalletConnect({
  connected,
  address,
  balance,
  connecting,
  detecting,
  kaswareDetected,
  error,
  onConnect,
  onDisconnect,
}: WalletConnectProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000)
      return () => clearTimeout(t)
    }
  }, [copied])

  const handleCopy = () => {
    navigator.clipboard.writeText(address)
    setCopied(true)
  }

  if (connected) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-kaspa-border rounded-xl px-3 py-2 transition-all"
        >
          <span className="w-2 h-2 rounded-full bg-kaspa-green animate-pulse" />
          <span className="text-sm font-medium hidden sm:inline">{balance}</span>
          <span className="text-sm text-kaspa-muted font-mono">{formatAddress(address)}</span>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              onClick={() => setOpen(false)}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => e.stopPropagation()}
                className="relative glass-strong rounded-2xl p-6 w-full max-w-sm animate-slide-up"
              >
                <button
                  onClick={() => setOpen(false)}
                  className="absolute top-4 right-4 text-kaspa-muted hover:text-white"
                >
                  <X size={18} />
                </button>

                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center">
                    <Wallet size={22} className="text-white" />
                  </div>
                  <div>
                    <p className="font-semibold">Connected</p>
                    <p className="text-sm text-kaspa-muted">KasWare Wallet</p>
                  </div>
                </div>

                <div className="glass rounded-xl p-4 mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-kaspa-muted">Address</span>
                    <div className="flex items-center gap-2">
                      <button onClick={handleCopy} className="text-kaspa-muted hover:text-white transition-colors">
                        {copied ? <Check size={14} className="text-kaspa-green" /> : <Copy size={14} />}
                      </button>
                      <a
                        href={`https://explorer.kaspa.org/addresses/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-kaspa-muted hover:text-white transition-colors"
                      >
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                  <p className="font-mono text-sm break-all">{address}</p>
                </div>

                <div className="glass rounded-xl p-4 mb-6">
                  <span className="text-sm text-kaspa-muted">Balance</span>
                  <p className="text-xl font-bold">{balance} KAS</p>
                </div>

                <button
                  onClick={() => { onDisconnect(); setOpen(false) }}
                  className="w-full btn-secondary flex items-center justify-center gap-2 py-3"
                >
                  <LogOut size={16} />
                  Disconnect
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    )
  }

  if (detecting) {
    return (
      <button disabled className="btn-secondary flex items-center gap-2 py-2.5 px-4 opacity-60 cursor-wait">
        <Loader2 size={16} className="animate-spin" />
        Detecting wallet...
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={onConnect}
        disabled={connecting}
        className="btn-primary flex items-center gap-2 py-2.5 px-4"
      >
        {connecting ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Wallet size={16} />
            Connect KasWare
          </>
        )}
      </button>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-full mt-2 right-0 w-72 glass-strong rounded-xl p-3 z-50"
          >
            <div className="flex items-start gap-2 text-xs">
              <AlertTriangle size={14} className="text-kaspa-red shrink-0 mt-0.5" />
              <div>
                <p className="text-kaspa-red font-medium mb-1">Connection failed</p>
                <p className="text-kaspa-muted mb-2">{error}</p>
                {!kaswareDetected && (
                  <a
                    href="https://kasware.xyz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-kaspa-pink hover:underline font-medium"
                  >
                    <Download size={12} />
                    Install KasWare extension
                  </a>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
