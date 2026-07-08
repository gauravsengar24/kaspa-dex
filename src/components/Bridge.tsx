import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeftRight, ExternalLink, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { KASPLEX_BRIDGE_CONFIG, bridgeKAS, bridgeKRC20, getBridgeHistory } from "../utils/bridge"
import type { BridgeTransfer, BridgeConfig } from "../types"

export default function Bridge() {
  const [direction, setDirection] = useState<"deposit" | "withdraw">("deposit")
  const [amount, setAmount] = useState("")
  const [kaspaAddress, setKaspaAddress] = useState("")
  const [sending, setSending] = useState(false)
  const [transfers, setTransfers] = useState<BridgeTransfer[]>([])
  const [config] = useState<BridgeConfig>(KASPLEX_BRIDGE_CONFIG)

  useEffect(() => {
    getBridgeHistory().then(setTransfers)
  }, [])

  const handleBridge = async () => {
    if (!amount || !kaspaAddress || sending) return
    setSending(true)
    const result = await bridgeKAS(amount, kaspaAddress, config)
    const updated = [result, ...transfers]
    setTransfers(updated)
    localStorage.setItem("kaspadex_bridge_history", JSON.stringify(updated))
    setSending(false)
    if (result.status === "confirmed") {
      setAmount("")
      setKaspaAddress("")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Kasplex Bridge</h1>
        <p className="text-kaspa-muted text-sm mt-1">Bridge KAS between L1 and Kasplex zkEVM L2</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="glass-panel p-6 rounded-2xl">
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setDirection("deposit")}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  direction === "deposit" ? "bg-kaspa-accent text-white" : "bg-kaspa-surface text-kaspa-muted"
                }`}
              >
                Deposit (L1 → L2)
              </button>
              <button
                onClick={() => setDirection("withdraw")}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  direction === "withdraw" ? "bg-kaspa-accent text-white" : "bg-kaspa-surface text-kaspa-muted"
                }`}
              >
                Withdraw (L2 → L1)
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-kaspa-muted mb-1.5 block">Amount (KAS)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-kaspa-surface rounded-xl px-4 py-3 text-lg font-mono outline-none focus:ring-2 focus:ring-kaspa-accent/50"
                />
              </div>

              <div>
                <label className="text-sm text-kaspa-muted mb-1.5 block">
                  {direction === "deposit" ? "L1 Kaspa Address" : "L2 EVM Address"}
                </label>
                <input
                  type="text"
                  value={kaspaAddress}
                  onChange={(e) => setKaspaAddress(e.target.value)}
                  placeholder={direction === "deposit" ? "kaspa:..." : "0x..."}
                  className="w-full bg-kaspa-surface rounded-xl px-4 py-3 text-sm font-mono outline-none focus:ring-2 focus:ring-kaspa-accent/50"
                />
              </div>

              <div className="bg-kaspa-surface rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between text-kaspa-muted">
                  <span>Bridge Fee</span>
                  <span className="text-white">~10 KAS</span>
                </div>
                <div className="flex justify-between text-kaspa-muted">
                  <span>Min Deposit</span>
                  <span className="text-white">{config.minDeposit} KAS</span>
                </div>
                <div className="flex justify-between text-kaspa-muted">
                  <span>Network</span>
                  <span className="text-white">
                    {config.chainId === 167012 ? "Kasplex Testnet" : "Kasplex Mainnet"}
                  </span>
                </div>
                {direction === "deposit" && (
                  <div className="flex justify-between text-kaspa-muted">
                    <span>Bridge Contract</span>
                    <a
                      href={`${config.explorerUrl}/address/${config.kurveBridge}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-kaspa-accent hover:underline flex items-center gap-1"
                    >
                      Kurve <ExternalLink size={12} />
                    </a>
                  </div>
                )}
              </div>

              <button
                onClick={handleBridge}
                disabled={!amount || !kaspaAddress || sending}
                className="w-full btn-primary py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" /> Bridging...
                  </span>
                ) : (
                  `Bridge ${direction === "deposit" ? "to L2" : "to L1"}`
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass-panel p-5 rounded-2xl">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock size={14} className="text-kaspa-accent" /> Recent Transfers
            </h3>
            {transfers.length === 0 ? (
              <p className="text-xs text-kaspa-muted">No transfers yet</p>
            ) : (
              <div className="space-y-2">
                {transfers.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-2">
                      {t.status === "confirmed" ? (
                        <CheckCircle2 size={14} className="text-green-400" />
                      ) : t.status === "failed" ? (
                        <XCircle size={14} className="text-red-400" />
                      ) : (
                        <Loader2 size={14} className="text-yellow-400 animate-spin" />
                      )}
                      <div>
                        <p className="text-xs font-medium">{t.amount} KAS</p>
                        <p className="text-[10px] text-kaspa-muted">
                          {new Date(t.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {t.txHash && (
                      <a
                        href={`${config.explorerUrl}/tx/${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-kaspa-accent hover:text-kaspa-accent/80"
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-panel p-5 rounded-2xl">
            <h3 className="text-sm font-semibold mb-3">How it works</h3>
            <ol className="space-y-2 text-xs text-kaspa-muted list-decimal list-inside">
              <li>Send KAS to the Kurve Bridge contract</li>
              <li>ZK proof confirms deposit on L1</li>
              <li>bridgedKAS (BKAS) minted on L2</li>
              <li>Use BKAS in Kaspadex AMM</li>
              <li>Withdraw back via lockForBridge</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
