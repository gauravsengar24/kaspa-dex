import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Droplets, Plus, Minus, Lock, ArrowLeftRight, ExternalLink, RefreshCw } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatKaspa, formatAddress } from "../utils/kaspa"
import { NETWORK, TOKENS, KASPA_TOKEN } from "../utils/constants"

const SOMPI_PER_KAS = 100_000_000

interface PoolInfo {
  ticker: string
  kasReserve: number
  tokenReserve: number
  lockedKas: number
  lockedTokens: number
  price: number
  fee: number
  totalLpShares: number
  k: number
}

interface UserLP {
  lpShares: number
}

export default function LiquidityPool() {
  const { connected, connect, address, balanceRaw, balanceFormatted, connecting } = useKaspaWallet()
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [selected, setSelected] = useState<PoolInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [txId, setTxId] = useState<string | null>(null)
  const [userLP, setUserLP] = useState<UserLP | null>(null)

  const [swapMode, setSwapMode] = useState<"buy" | "sell">("buy")
  const [swapAmount, setSwapAmount] = useState("")
  const [swapping, setSwapping] = useState(false)

  const [lpKasAmount, setLpKasAmount] = useState("")
  const [lpTokenAmount, setLpTokenAmount] = useState("")
  const [lpMode, setLpMode] = useState<"add" | "remove">("add")
  const [lpShares, setLpShares] = useState("")

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPools = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${NETWORK.backend}/api/pool/list`)
      if (res.ok) {
        const data = await res.json()
        if (mountedRef.current) setPools(data.pools || [])
      }
    } catch { /* ignore */ }
    if (mountedRef.current) setLoading(false)
  }, [])

  useEffect(() => { fetchPools() }, [fetchPools])

  const fetchUserLP = useCallback(async (ticker: string) => {
    if (!address) return
    try {
      const res = await fetch(`${NETWORK.backend}/api/pool/user-lp/${ticker}/${address}`)
      if (res.ok) {
        const data = await res.json()
        if (mountedRef.current) setUserLP(data)
      }
    } catch { /* ignore */ }
  }, [address])

  useEffect(() => {
    if (selected && address) fetchUserLP(selected.ticker)
  }, [selected, address, fetchUserLP])

  const showError = (msg: string) => { setError(msg); setTimeout(() => { if (mountedRef.current) setError(null) }, 5000) }
  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => { if (mountedRef.current) setSuccess(null) }, 5000) }

  const handleSwap = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!swapAmount || !selected || Number(swapAmount) <= 0) return
    if (!window.kasware) { showError("KasWare not detected"); return }

    setSwapping(true)
    setError(null)
    setTxId(null)
    try {
      const sompi = Math.floor(Number(swapAmount) * SOMPI_PER_KAS)
      const sendTo = "kaspa:qzhc7qlqpl62vg9jq6mla8g6377mk7ufxgjndnj5c2ef2qvvw3qwm0nar5wq"
      const txHash = await window.kasware.sendKaspa(sendTo, sompi)
      setTxId(txHash)

      const endpoint = swapMode === "buy" ? "swap/buy" : "swap/sell"
      const payload = swapMode === "buy"
        ? { ticker: selected.ticker, kas_amount: Number(swapAmount), user: address }
        : { ticker: selected.ticker, token_amount: Number(swapAmount), user: address }

      const res = await fetch(`${NETWORK.backend}/api/pool/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err)
      }
      const result = await res.json()
      showSuccess(swapMode === "buy"
        ? `Swapped ${swapAmount} KAS → ${result.tokens_out} ${selected.ticker}`
        : `Swapped ${swapAmount} ${selected.ticker} → ${result.kas_out} KAS`
      )
      setSwapAmount("")
      fetchPools()
    } catch (err) {
      showError(err instanceof Error ? err.message : "Swap failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, swapAmount, selected, swapMode, address, fetchPools])

  const handleAddLiquidity = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!lpKasAmount || !lpTokenAmount || !selected) return
    if (!window.kasware) { showError("KasWare not detected"); return }

    setSwapping(true)
    setError(null)
    try {
      const sompi = Math.floor(Number(lpKasAmount) * SOMPI_PER_KAS)
      const txHash = await window.kasware.sendKaspa(
        "kaspa:qzhc7qlqpl62vg9jq6mla8g6377mk7ufxgjndnj5c2ef2qvvw3qwm0nar5wq",
        sompi
      )
      setTxId(txHash)

      const res = await fetch(`${NETWORK.backend}/api/pool/add-liquidity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: selected.ticker,
          kas_amount: Number(lpKasAmount),
          token_amount: Number(lpTokenAmount),
          user: address,
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err)
      }
      const result = await res.json()
      showSuccess(`Added liquidity! You got ${result.lp_shares.toFixed(6)} LP shares`)
      setLpKasAmount("")
      setLpTokenAmount("")
      fetchPools()
      fetchUserLP(selected.ticker)
    } catch (err) {
      showError(err instanceof Error ? err.message : "Add liquidity failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, lpKasAmount, lpTokenAmount, selected, address, fetchPools, fetchUserLP])

  const handleRemoveLiquidity = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!lpShares || !selected || Number(lpShares) <= 0) return
    setSwapping(true)
    setError(null)
    try {
      const res = await fetch(`${NETWORK.backend}/api/pool/remove-liquidity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: selected.ticker, shares: Number(lpShares), user: address }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err)
      }
      const result = await res.json()
      showSuccess(`Removed liquidity! Got ${result.kas_removed} KAS + ${result.tokens_removed} ${selected.ticker}`)
      setLpShares("")
      fetchPools()
      fetchUserLP(selected.ticker)
    } catch (err) {
      showError(err instanceof Error ? err.message : "Remove liquidity failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, lpShares, selected, address, fetchPools, fetchUserLP])

  if (!connected) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="glass rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-kaspa-purple to-kaspa-pink flex items-center justify-center mx-auto mb-4">
            <Droplets size={28} className="text-white" />
          </div>
          <h2 className="text-xl font-bold mb-2">Liquidity Pools</h2>
          <p className="text-kaspa-muted text-sm mb-6">
            Graduated tokens trade on AMM pools with permanently locked liquidity.
          </p>
          <button onClick={connect} className="btn-primary px-8 py-3">
            {connecting ? "Connecting..." : "Connect KasWare"}
          </button>
        </div>
      </div>
    )
  }

  const getTokenIcon = (ticker: string) => {
    const t = TOKENS.find(tk => tk.ticker === ticker)
    return t?.icon || "🪙"
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-bold">Liquidity Pools</h2>
          <p className="text-xs text-kaspa-muted">Graduated AMM pools with permanently locked liquidity</p>
        </div>
        <button onClick={fetchPools} className="btn-secondary p-2.5">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && pools.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center text-kaspa-muted text-sm">
          <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
          Loading pools...
        </div>
      ) : pools.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Droplets size={24} className="text-kaspa-muted mx-auto mb-3" />
          <p className="text-kaspa-muted text-sm mb-1">No graduated pools yet</p>
          <p className="text-xs text-kaspa-muted/60">Tokens graduate from the bonding curve at 1000 KAS market cap</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pools.map((pool) => (
            <motion.div
              key={pool.ticker}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass rounded-xl overflow-hidden ${
                selected?.ticker === pool.ticker ? "border-kaspa-purple/50" : ""
              }`}
            >
              <div
                className="p-4 cursor-pointer"
                onClick={() => { setSelected(pool); setError(null); setSwapAmount(""); setLpKasAmount(""); setLpTokenAmount(""); setLpShares("") }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{getTokenIcon(pool.ticker)}</span>
                    <div>
                      <div className="font-semibold">{pool.ticker}/KAS</div>
                      <div className="flex items-center gap-1 text-[10px] text-kaspa-muted">
                        <Lock size={10} className="text-kaspa-green" />
                        {pool.lockedKas.toFixed(2)} KAS + {pool.lockedTokens.toFixed(0)} {pool.ticker} locked
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm">{pool.price.toFixed(8)}</div>
                    <div className="text-[10px] text-kaspa-muted">KAS per {pool.ticker}</div>
                  </div>
                </div>
                <div className="flex gap-4 text-xs text-kaspa-muted">
                  <span>KAS: {pool.kasReserve.toFixed(2)}</span>
                  <span>{pool.ticker}: {pool.tokenReserve.toFixed(0)}</span>
                  <span>LP: {pool.totalLpShares.toFixed(2)}</span>
                </div>
              </div>

              {selected?.ticker === pool.ticker && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="border-t border-kaspa-border/30"
                >
                  <div className="flex border-b border-kaspa-border/30">
                    <button
                      onClick={() => setSwapMode("buy")}
                      className={`flex-1 py-3 text-sm font-medium text-center transition-all ${swapMode === "buy" ? "text-kaspa-green border-b-2 border-kaspa-green" : "text-kaspa-muted"}`}
                    >Buy {pool.ticker}</button>
                    <button
                      onClick={() => setSwapMode("sell")}
                      className={`flex-1 py-3 text-sm font-medium text-center transition-all ${swapMode === "sell" ? "text-kaspa-red border-b-2 border-kaspa-red" : "text-kaspa-muted"}`}
                    >Sell {pool.ticker}</button>
                    <button
                      onClick={() => setLpMode("add")}
                      className={`flex-1 py-3 text-sm font-medium text-center transition-all ${lpMode === "add" ? "text-kaspa-purple border-b-2 border-kaspa-purple" : "text-kaspa-muted"}`}
                    ><Plus size={12} className="inline" /> LP</button>
                    <button
                      onClick={() => setLpMode("remove")}
                      className={`flex-1 py-3 text-sm font-medium text-center transition-all ${lpMode === "remove" ? "text-kaspa-cyan border-b-2 border-kaspa-cyan" : "text-kaspa-muted"}`}
                    ><Minus size={12} className="inline" /> LP</button>
                  </div>

                  <div className="p-4">
                    {(swapMode === "buy" || swapMode === "sell") && (
                      <div className="glass rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-kaspa-muted">
                            {swapMode === "buy" ? `Send KAS` : `Send ${pool.ticker}`}
                          </span>
                          <span className="text-xs text-kaspa-muted">Balance: {balanceFormatted} KAS</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="text" value={swapAmount}
                            onChange={e => /^\d*\.?\d*$/.test(e.target.value) && setSwapAmount(e.target.value)}
                            placeholder="0.0" className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none"
                          />
                          <div className="bg-white/10 rounded-xl px-3 py-2 shrink-0 font-semibold text-sm">
                            {swapMode === "buy" ? "KAS" : pool.ticker}
                          </div>
                        </div>
                        {swapAmount && Number(swapAmount) > 0 && (
                          <p className="text-xs text-kaspa-muted mt-2">
                            {swapMode === "buy"
                              ? `~${(Number(swapAmount) / pool.price).toFixed(2)} ${pool.ticker}`
                              : `~${(Number(swapAmount) * pool.price).toFixed(6)} KAS`}
                          </p>
                        )}
                        <button
                          onClick={handleSwap}
                          disabled={!swapAmount || Number(swapAmount) <= 0 || swapping}
                          className="btn-primary w-full mt-3 py-2.5"
                        >
                          {swapping ? "Swapping..." : swapMode === "buy" ? `Buy ${pool.ticker}` : `Sell ${pool.ticker}`}
                        </button>
                      </div>
                    )}

                    {lpMode === "add" && (
                      <div className="glass rounded-xl p-4 space-y-3">
                        <div>
                          <label className="text-xs text-kaspa-muted block mb-1">KAS to add</label>
                          <input
                            type="text" value={lpKasAmount}
                            onChange={e => /^\d*\.?\d*$/.test(e.target.value) && setLpKasAmount(e.target.value)}
                            placeholder="0.0" className="w-full bg-white/5 rounded-xl px-4 py-2.5 outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-kaspa-muted block mb-1">{pool.ticker} to add</label>
                          <input
                            type="text" value={lpTokenAmount}
                            onChange={e => /^\d*\.?\d*$/.test(e.target.value) && setLpTokenAmount(e.target.value)}
                            placeholder="0.0" className="w-full bg-white/5 rounded-xl px-4 py-2.5 outline-none"
                          />
                        </div>
                        {lpKasAmount && lpTokenAmount && Number(lpKasAmount) > 0 && Number(lpTokenAmount) > 0 && (
                          <p className="text-xs text-kaspa-muted">
                            Ratio: {(Number(lpKasAmount) / Number(lpTokenAmount)).toFixed(6)} KAS per {pool.ticker}
                          </p>
                        )}
                        <button
                          onClick={handleAddLiquidity}
                          disabled={!lpKasAmount || !lpTokenAmount || swapping}
                          className="btn-primary w-full py-2.5"
                        >
                          {swapping ? "Adding..." : "Add Liquidity"}
                        </button>
                      </div>
                    )}

                    {lpMode === "remove" && (
                      <div className="glass rounded-xl p-4 space-y-3">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-kaspa-muted">Your LP shares</span>
                          <span className="font-semibold">{userLP?.lpShares.toFixed(6) || "0"}</span>
                        </div>
                        <div>
                          <label className="text-xs text-kaspa-muted block mb-1">LP shares to remove</label>
                          <input
                            type="text" value={lpShares}
                            onChange={e => /^\d*\.?\d*$/.test(e.target.value) && setLpShares(e.target.value)}
                            placeholder="0.0" className="w-full bg-white/5 rounded-xl px-4 py-2.5 outline-none"
                          />
                        </div>
                        <button
                          onClick={handleRemoveLiquidity}
                          disabled={!lpShares || Number(lpShares) <= 0 || swapping}
                          className="btn-primary w-full py-2.5"
                        >
                          {swapping ? "Removing..." : "Remove Liquidity"}
                        </button>
                      </div>
                    )}
                  </div>
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
