import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { TrendingUp, Rocket, Check, ExternalLink, RefreshCw } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatKaspa, formatAddress } from "../utils/kaspa"
import { NETWORK, TOKENS, KASPA_TOKEN } from "../utils/constants"

interface BondingTokenInfo {
  ticker: string
  name: string
  icon: string
  creator: string
  supplySold: number
  kasRaised: number
  currentPrice: number
  marketCapKas: number
  progressPct: number
  graduated: boolean
  graduatedAt: number | null
  createdAt: number
  totalSupply: number
  graduationThreshold: number
}

export default function BondingCurve() {
  const { connected, connect, address, balanceRaw, balanceFormatted, connecting } = useKaspaWallet()
  const [tokens, setTokens] = useState<BondingTokenInfo[]>([])
  const [selected, setSelected] = useState<BondingTokenInfo | null>(null)
  const [kasAmount, setKasAmount] = useState("")
  const [loading, setLoading] = useState(true)
  const [swapping, setSwapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [txId, setTxId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTicker, setNewTicker] = useState("")
  const [newName, setNewName] = useState("")
  const [newIcon, setNewIcon] = useState("🪙")
  const mountedRef = useRef(true)

  const ICONS = ["🪙", "💎", "🚀", "🔥", "🌙", "⭐", "🐱", "🦊", "🐻", "🐂", "🌊", "⚡", "🎯", "🧠", "👑"]

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchTokens = useCallback(async (graduated?: boolean) => {
    setLoading(true)
    try {
      const params = graduated !== undefined ? `?graduated=${graduated}` : ""
      const res = await fetch(`${NETWORK.backend}/api/bonding/tokens${params}`)
      if (res.ok) {
        const data = await res.json()
        if (mountedRef.current) setTokens(data)
      }
    } catch { /* ignore */ }
    if (mountedRef.current) setLoading(false)
  }, [])

  useEffect(() => { fetchTokens(false) }, [fetchTokens])

  const showError = (msg: string) => { setError(msg); setTimeout(() => { if (mountedRef.current) setError(null) }, 5000) }
  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => { if (mountedRef.current) setSuccess(null) }, 5000) }

  const handleCreate = useCallback(async () => {
    if (!newTicker || !newName) { showError("Enter ticker and name"); return }
    try {
      const res = await fetch(`${NETWORK.backend}/api/bonding/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: newTicker.toUpperCase(), name: newName, icon: newIcon, creator: address }),
      })
      if (res.ok) {
        showSuccess(`Token ${newTicker.toUpperCase()} created!`)
        setShowCreate(false)
        setNewTicker("")
        setNewName("")
        fetchTokens(false)
      } else {
        const err = await res.text()
        showError(err)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Create failed")
    }
  }, [newTicker, newName, newIcon, address, fetchTokens])

  const handleBuy = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!kasAmount || !selected || Number(kasAmount) <= 0) return

    setSwapping(true)
    setError(null)
    setTxId(null)
    try {
      const res = await fetch(`${NETWORK.backend}/api/bonding/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: selected.ticker, kas_amount: Number(kasAmount), buyer: address }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err)
      }
      const result = await res.json()
      showSuccess(`Bought ${result.tokens_bought} ${selected.ticker}!`)
      setKasAmount("")
      fetchTokens(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : "Buy failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, kasAmount, selected, address, fetchTokens])

  const handleSell = useCallback(async (token: BondingTokenInfo) => {
    if (!connected) { await connect(); return }
    if (!window.kasware) { showError("KasWare not detected"); return }
    setSwapping(true)
    setError(null)
    try {
      const res = await fetch(`${NETWORK.backend}/api/bonding/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: token.ticker, token_amount: 0, seller: address }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err)
      }
      const result = await res.json()
      showSuccess(`Sold tokens for ${result.kas_returned} KAS!`)
      fetchTokens(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : "Sell failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, address, fetchTokens])

  if (!connected) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="glass rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-kaspa-cyan to-kaspa-green flex items-center justify-center mx-auto mb-4">
            <Rocket size={28} className="text-white" />
          </div>
          <h2 className="text-xl font-bold mb-2">Launch Tokens</h2>
          <p className="text-kaspa-muted text-sm mb-6">
            New tokens start on a bonding curve. Once they graduate, liquidity is locked forever.
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
          <h2 className="text-lg font-display font-bold">Token Launchpad</h2>
          <p className="text-xs text-kaspa-muted">Bonding curve → graduated AMM with locked liquidity</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-1.5 px-4">
            <Rocket size={14} /> Launch Token
          </button>
          <button onClick={() => fetchTokens(false)} className="btn-secondary p-2.5">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-2xl p-5"
          >
            <h3 className="font-semibold mb-4">Launch New Token</h3>
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-kaspa-muted block mb-1">Ticker</label>
                  <input
                    type="text" value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase().slice(0, 10))}
                    placeholder="e.g. MOON" className="w-full bg-white/5 rounded-xl px-4 py-2.5 outline-none border border-kaspa-border/50"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-kaspa-muted block mb-1">Name</label>
                  <input
                    type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Moon Token" className="w-full bg-white/5 rounded-xl px-4 py-2.5 outline-none border border-kaspa-border/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-kaspa-muted block mb-1">Icon</label>
                  <select
                    value={newIcon} onChange={e => setNewIcon(e.target.value)}
                    className="bg-white/5 rounded-xl px-3 py-2.5 outline-none border border-kaspa-border/50 text-lg"
                  >
                    {ICONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
                  </select>
                </div>
              </div>
              <div className="text-[11px] text-kaspa-muted space-y-1 bg-white/5 rounded-xl p-3">
                <p>• Price starts at 0.001 KAS and increases linearly to 0.01 KAS</p>
                <p>• Graduates to an AMM pool at {1000} KAS market cap</p>
                <p>• Initial liquidity is locked forever — rug-proof</p>
                <p>• Total supply: 1,000,000,000 tokens</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
                <button onClick={handleCreate} disabled={!newTicker || !newName} className="btn-primary flex-1">
                  Launch {newTicker || "Token"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && tokens.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center text-kaspa-muted text-sm">
          <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
          Loading tokens...
        </div>
      ) : tokens.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Rocket size={24} className="text-kaspa-muted mx-auto mb-3" />
          <p className="text-kaspa-muted text-sm mb-1">No tokens launched yet</p>
          <p className="text-xs text-kaspa-muted/60 mb-4">Launch the first token on the bonding curve</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">Launch Token</button>
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
                  <div className="font-mono text-sm">{token.currentPrice.toFixed(6)} KAS</div>
                  <div className="text-[10px] text-kaspa-muted">
                    MCap: {token.marketCapKas.toFixed(2)} KAS
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
                <span>{token.supplySold.toFixed(0)} / {token.totalSupply.toFixed(0)} tokens sold</span>
                <span>{token.progressPct.toFixed(1)}% to graduation ({token.graduationThreshold} KAS)</span>
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
                      <p className="text-xs text-kaspa-green mt-1">
                        ~{(Number(kasAmount) / token.currentPrice).toFixed(2)} {token.ticker}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleBuy}
                    disabled={!kasAmount || Number(kasAmount) <= 0 || swapping}
                    className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                  >
                    {swapping ? "Buying..." : `Buy ${token.ticker} with KAS`}
                  </button>
                  {token.supplySold > 0 && (
                    <button
                      onClick={() => handleSell(token)}
                      disabled={swapping}
                      className="btn-secondary w-full mt-2 text-sm"
                    >
                      Sell {token.ticker} (90% of curve price)
                    </button>
                  )}
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
            TX: <a href={`https://explorer.kaspa.org/transactions/${txId}`} target="_blank" rel="noopener noreferrer" className="underline">{txId.slice(0, 20)}...</a>
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
