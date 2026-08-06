import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { TrendingUp, RefreshCw, ExternalLink } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import {
  discoverTokens,
  getToken,
  buyOnCurve,
  walletBridge,
  type Kcc20Token,
} from "../utils/kcc20"

interface BondingTokenInfo {
  ticker: string
  name: string
  icon: string
  price: number
  priceChange: number
  volume24h: number
  progressPct: number
  graduationThreshold: number
  kasRaised: number
}

export default function BondingCurve() {
  const { connected, connect, balanceFormatted, connecting } = useKaspaWallet()
  const [tokens, setTokens] = useState<BondingTokenInfo[]>([])
  const [selected, setSelected] = useState<BondingTokenInfo | null>(null)
  const [kasAmount, setKasAmount] = useState("")
  const [loading, setLoading] = useState(true)
  const [swapping, setSwapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [txId, setTxId] = useState<string | null>(null)
  const [kcc20ByTick, setKcc20ByTick] = useState<Map<string, Kcc20Token>>(new Map())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchTokens = useCallback(async () => {
    setLoading(true)
    try {
      const kcc20 = await discoverTokens()
      const map = new Map<string, Kcc20Token>()
      const rows: BondingTokenInfo[] = []
      for (const t of kcc20) {
        if (t.graduated) continue
        map.set(t.tick.toLowerCase(), t)
        const live = await getToken(t.tick).catch(() => null)
        const gradKas = live?.cpState?.graduationKas ?? 0
        const raised = live?.cpState?.realKas ? Number(live.cpState.realKas) / 100_000_000 : 0
        rows.push({
          ticker: t.tick,
          name: t.name,
          icon: t.toTokenInfo().icon || "🪙",
          price: live?.price ?? 0,
          priceChange: live?.change24h ?? 0,
          volume24h: live?.volume24h ?? 0,
          progressPct: gradKas > 0 ? Math.min(100, (raised / (gradKas / 100_000_000)) * 100) : 0,
          graduationThreshold: gradKas > 0 ? Math.round(gradKas / 100_000_000) : 1000,
          kasRaised: raised,
        })
      }
      if (mountedRef.current) {
        setTokens(rows)
        setKcc20ByTick(map)
      }
    } catch { /* keep existing */ }
    if (mountedRef.current) setLoading(false)
  }, [])

  useEffect(() => { fetchTokens() }, [fetchTokens])

  const showError = (msg: string) => { setError(msg); setTimeout(() => { if (mountedRef.current) setError(null) }, 8000) }
  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => { if (mountedRef.current) setSuccess(null) }, 8000) }

  const handleBuy = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!kasAmount || !selected || Number(kasAmount) <= 0) return
    const bridge = walletBridge()
    if (!bridge) { showError("KasWare wallet bridge unavailable"); return }

    setSwapping(true)
    setError(null)
    setTxId(null)
    try {
      const res = await buyOnCurve(selected.ticker, Number(kasAmount), bridge)
      showSuccess(`Bought ${selected.ticker} on-chain!`)
      setKasAmount("")
      setTxId(res.txid)
      fetchTokens()
    } catch (err) {
      showError(err instanceof Error ? err.message : "Buy failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, kasAmount, selected, fetchTokens])

  if (!connected) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="glass rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-kaspa-cyan to-kaspa-green flex items-center justify-center mx-auto mb-4">
            <TrendingUp size={28} className="text-white" />
          </div>
          <h2 className="text-xl font-bold mb-2">KRON Bonding Curves</h2>
          <p className="text-kaspa-muted text-sm mb-6">
            New tokens start on an L1 bonding curve (KCC-20). Once they raise their target, they graduate to a liquidity-locked AMM pool.
          </p>
          <button onClick={connect} className="btn-primary px-8 py-3">
            {connecting ? "Connecting..." : "Connect KasWare"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-bold">Bonding Curves</h2>
          <p className="text-xs text-kaspa-muted">KCC-20 tokens on KRON L1 covenants · mainnet</p>
        </div>
        <button onClick={() => fetchTokens()} className="btn-secondary p-2.5" title="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="glass rounded-2xl p-12 text-center text-kaspa-muted text-sm">
          <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
          Loading live curves...
        </div>
      ) : tokens.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <TrendingUp size={24} className="text-kaspa-muted mx-auto mb-3" />
          <p className="text-kaspa-muted text-sm">No pre-graduation KCC-20 tokens found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tokens.map((token) => (
            <motion.div
              key={token.ticker}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass rounded-xl p-4 cursor-pointer transition-all ${
                selected?.ticker === token.ticker ? "border-kaspa-cyan/50" : "hover:border-kaspa-border/50"
              }`}
              onClick={() => { setSelected(token); setKasAmount(""); setError(null) }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{token.icon}</span>
                  <div>
                    <div className="font-semibold">{token.ticker}</div>
                    <div className="text-xs text-kaspa-muted">{token.name}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">{token.price.toFixed(8)} KAS</div>
                  <div className="text-[10px] text-kaspa-muted">
                    Raised: {token.kasRaised.toFixed(2)} KAS ·{" "}
                    <span className={token.priceChange < 0 ? "text-kaspa-red" : "text-kaspa-green"}>
                      {token.priceChange >= 0 ? "+" : ""}{token.priceChange.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="w-full bg-white/5 rounded-full h-2 mb-2 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-kaspa-cyan to-kaspa-green transition-all"
                  style={{ width: `${Math.min(100, token.progressPct)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-kaspa-muted">
                <span>{token.progressPct.toFixed(1)}% to graduation ({token.graduationThreshold} KAS)</span>
                <span>Bonding curve · KCC-20</span>
              </div>

              {selected?.ticker === token.ticker && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="mt-4 pt-4 border-t border-kaspa-border/30"
                >
                  <div className="glass rounded-xl p-4 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-kaspa-muted">Buy with KAS</span>
                      <span className="text-xs text-kaspa-muted">Balance: {balanceFormatted} KAS</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text" value={kasAmount} onChange={e => /^\d*\.?\d*$/.test(e.target.value) && setKasAmount(e.target.value)}
                        placeholder="0.0" className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none"
                      />
                      <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2 shrink-0">
                        <span className="font-semibold">KAS</span>
                      </div>
                    </div>
                    {kasAmount && Number(kasAmount) > 0 && (
                      <p className="text-xs text-kaspa-muted mt-1">
                        ~{(Number(kasAmount) / (token.price || 1)).toFixed(2)} {token.ticker} + protocol fees
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleBuy}
                    disabled={!kasAmount || Number(kasAmount) <= 0 || swapping}
                    className="btn-primary w-full py-3"
                  >
                    {swapping ? "Building + signing..." : connected ? `Buy ${token.ticker} with KAS` : "Connect KasWare"}
                  </button>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {txId && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-xl p-3 text-sm text-kaspa-green text-center"
          >
            TX:{" "}
            <a href={`https://explorer.kaspa.org/transactions/${txId}`} target="_blank" rel="noopener noreferrer" className="underline">
              {txId.slice(0, 20)}... <ExternalLink size={10} className="inline" />
            </a>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-xl p-3 text-sm text-kaspa-red text-center border border-kaspa-red/30"
          >{error}</motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-xl p-3 text-sm text-kaspa-green text-center border border-kaspa-green/30"
          >{success}</motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
