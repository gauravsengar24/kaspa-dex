import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeftRight, Plus, RefreshCw, ExternalLink, Check, Copy, Send, AlertTriangle, Shield } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatKaspa, formatAddress } from "../utils/kaspa"
import { NETWORK, TOKENS, KASPA_TOKEN } from "../utils/constants"
import type { TokenInfo } from "../types"
import { getKrc20Balances, transferKrc20, getTotalKrc20Balance } from "../utils/krc20"
import { buildMakerPskt, signMakerPskt, pushTransaction } from "../utils/psktSwap"

const SOMPI_PER_KAS = 100_000_000

interface Offer {
  id: string
  makerAddress: string
  makerAmount: number
  makerToken: string
  takerAmount: number
  takerToken: string
  timestamp: number
  status: string
  makerPrice: number
  usdValue: number
}

export default function P2PSwap() {
  const { connected, connect, address, balanceRaw, balanceFormatted, connecting, krc20Balances } = useKaspaWallet()

  const [mode, setMode] = useState<"orderbook" | "create" | "accept">("orderbook")
  const [offers, setOffers] = useState<Offer[]>([])
  const [kasUsdPrice, setKasUsdPrice] = useState(0.15)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [makerToken, setMakerToken] = useState<TokenInfo>(KASPA_TOKEN)
  const [makerAmount, setMakerAmount] = useState("")
  const [takerToken, setTakerToken] = useState<TokenInfo>(TOKENS[1])
  const [takerAmount, setTakerAmount] = useState("")

  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [acceptedOffer, setAcceptedOffer] = useState<Offer | null>(null)
  const [txStatus, setTxStatus] = useState<"idle" | "building" | "signing" | "broadcasting" | "done" | "error">("idle")
  const [txId, setTxId] = useState<string | null>(null)
  const [psktHex, setPsktHex] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [filterPair, setFilterPair] = useState<string>("all")
  const [acceptMethod, setAcceptMethod] = useState<"pskt" | "direct">("pskt")
  const [krc20SenderBalances, setKrc20SenderBalances] = useState<any[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (connected && address) {
      getKrc20Balances(address).then(b => {
        if (mountedRef.current) setKrc20SenderBalances(b)
      })
    }
  }, [connected, address])

  const fetchOffers = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterPair !== "all" ? `?token_pair=${filterPair}` : ""
      const res = await fetch(`${NETWORK.backend}/api/swap/orders${params}`)
      if (res.ok) {
        const data = await res.json()
        if (mountedRef.current) {
          setOffers(data.offers || [])
          setKasUsdPrice(data.kasUsdPrice || 0.15)
        }
      }
    } catch { /* ignore */ }
    if (mountedRef.current) setLoading(false)
  }, [filterPair])

  useEffect(() => {
    fetchOffers()
    const interval = setInterval(fetchOffers, 15000)
    return () => clearInterval(interval)
  }, [fetchOffers])

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => { if (mountedRef.current) setError(null) }, 5000)
  }

  const showSuccess = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => { if (mountedRef.current) setSuccess(null) }, 5000)
  }

  const handleCreateOffer = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!makerAmount || !takerAmount || Number(makerAmount) <= 0 || Number(takerAmount) <= 0) {
      showError("Enter valid amounts")
      return
    }
    try {
      const res = await fetch(`${NETWORK.backend}/api/orderbook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          makerAddress: address,
          makerAmount: Number(makerAmount),
          makerToken: makerToken.ticker,
          takerAmount: Number(takerAmount),
          takerToken: takerToken.ticker,
        }),
      })
      if (res.ok) {
        showSuccess("Offer created! Appears in the orderbook.")
        setMakerAmount("")
        setTakerAmount("")
        setMode("orderbook")
        fetchOffers()
      } else {
        const err = await res.text()
        showError(`Failed: ${err}`)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create offer")
    }
  }, [connected, connect, address, makerAmount, makerToken, takerAmount, takerToken, fetchOffers])

  const handleAccept = useCallback(async (offer: Offer) => {
    if (!connected) { await connect(); return }
    setAcceptingId(offer.id)
    setAccepting(true)
    setTxStatus("idle")
    setTxId(null)
    setPsktHex(null)
    setAcceptedOffer(null)
    setError(null)

    try {
      const res = await fetch(`${NETWORK.backend}/api/swap/accept/${offer.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taker_address: address }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err)
      }
      const data = await res.json()
      setAcceptedOffer(offer)
      setMode("accept")
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to accept offer")
      setAccepting(false)
      setAcceptingId(null)
    }
  }, [connected, connect, address])

  const executePsktSwap = useCallback(async () => {
    if (!acceptedOffer || !window.kasware) {
      showError("KasWare wallet not detected")
      return
    }
    setTxStatus("building")
    setError(null)

    try {
      if (acceptedOffer.takerToken === "KAS" && acceptedOffer.makerToken === "KAS") {
        const sompi = Math.floor(Number(acceptedOffer.takerAmount) * SOMPI_PER_KAS)
        setTxStatus("signing")
        const txHash = await window.kasware.sendKaspa(acceptedOffer.makerAddress, sompi)
        setTxId(txHash)
        setTxStatus("done")
        showSuccess(`KAS sent on-chain! TX: ${txHash.slice(0, 16)}...`)
        setMode("orderbook")
        fetchOffers()
        return
      }

      if (acceptedOffer.takerToken !== "KAS") {
        setTxStatus("signing")
        const tick = acceptedOffer.takerToken
        const takerBal = getTotalKrc20Balance(tick, krc20SenderBalances as any)
        const needed = acceptedOffer.takerAmount
        if (takerBal < needed) {
          throw new Error(`Insufficient ${tick} balance. You have ${takerBal.toFixed(2)}, need ${needed.toFixed(2)}`)
        }
        const rawAmt = BigInt(Math.floor(needed * 1e8)).toString()
        const result = await transferKrc20(tick, rawAmt, acceptedOffer.makerAddress, 0.1)
        setTxId(result.revealId || result.commitId)
        setTxStatus("done")
        showSuccess(`KRC-20 transfer submitted! Reveal TX: ${result.revealId?.slice(0, 16) || "pending"}...`)
        setMode("orderbook")
        fetchOffers()
        return
      }

      throw new Error("Unsupported swap pair. Try the direct send method.")
    } catch (err) {
      setTxStatus("error")
      showError(err instanceof Error ? err.message : "Swap execution failed")
    } finally {
      setAccepting(false)
      setAcceptingId(null)
    }
  }, [acceptedOffer, address, krc20SenderBalances, fetchOffers])

  const executeDirectSend = useCallback(async () => {
    if (!acceptedOffer || !window.kasware) {
      showError("KasWare wallet not detected")
      return
    }
    setTxStatus("signing")
    setError(null)

    try {
      const sompi = Math.floor(Number(acceptedOffer.takerAmount) * SOMPI_PER_KAS)
      const txHash = await window.kasware.sendKaspa(acceptedOffer.makerAddress, sompi)
      setTxId(txHash)
      setTxStatus("done")
      showSuccess(`Sent ${acceptedOffer.takerAmount} KAS directly on-chain! TX: ${txHash.slice(0, 16)}...`)
      setMode("orderbook")
      fetchOffers()
    } catch (err) {
      setTxStatus("error")
      showError(err instanceof Error ? err.message : "Send failed")
    } finally {
      setAccepting(false)
      setAcceptingId(null)
    }
  }, [acceptedOffer, address, fetchOffers])

  const handleCopy = () => {
    if (acceptedOffer) {
      navigator.clipboard.writeText(acceptedOffer.makerAddress)
      setCopied(true)
      setTimeout(() => { if (mountedRef.current) setCopied(false) }, 2000)
    }
  }

  const handleCopyPskt = () => {
    if (psktHex) {
      navigator.clipboard.writeText(psktHex)
      setCopied(true)
      setTimeout(() => { if (mountedRef.current) setCopied(false) }, 2000)
    }
  }

  const pairs = ["all", "KAS_USDT", "KAS_NACHO", "KAS_KASPER", "KAS_PEPEK", "KAS_GHOST", "KAS_KASPY", "KAS_KISHU"]

  const getTokenIcon = (ticker: string): string => {
    const t = TOKENS.find(tk => tk.ticker === ticker)
    return t?.icon || KASPA_TOKEN.icon
  }

  if (!connected) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="glass rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center mx-auto mb-4">
            <ArrowLeftRight size={28} className="text-white" />
          </div>
          <h2 className="text-xl font-bold mb-2">P2P Atomic Swap</h2>
          <p className="text-kaspa-muted text-sm mb-6">
            Trustless peer-to-peer swaps. KAS sent directly between wallets — no intermediary.
          </p>
          <button onClick={connect} className="btn-primary px-8 py-3">
            {connecting ? "Connecting..." : "Connect KasWare to Start"}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-bold">P2P Atomic Swap</h2>
          <p className="text-xs text-kaspa-muted">
            {formatKaspa(balanceRaw)} KAS &middot; 1 KAS = ${kasUsdPrice.toFixed(4)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setMode("create"); setError(null) }}
            className="btn-primary text-sm flex items-center gap-1.5 px-4"
          >
            <Plus size={14} /> Create Offer
          </button>
          <button onClick={fetchOffers} className="btn-secondary p-2.5" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-kaspa-muted bg-white/5 rounded-xl px-3 py-2">
        <Shield size={12} className="text-kaspa-green shrink-0" />
        <span>All on-chain. KAS sent directly between wallets. KRC-20 via KasWare commit-reveal.</span>
      </div>

      <AnimatePresence mode="wait">
        {mode === "create" && (
          <motion.div
            key="create"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-2xl p-5"
          >
            <h3 className="font-semibold mb-4">Create Swap Offer</h3>

            <div className="glass rounded-xl p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-kaspa-muted">You sell</span>
                <span className="text-xs text-kaspa-muted">
                  Balance: {formatKaspa(balanceRaw)} KAS
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={makerAmount}
                  onChange={e => /^\d*\.?\d*$/.test(e.target.value) && setMakerAmount(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none"
                />
                <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
                  <span className="text-lg">{makerToken.icon}</span>
                  <select
                    value={makerToken.ticker}
                    onChange={e => {
                      const t = [...TOKENS, KASPA_TOKEN].find(tk => tk.ticker === e.target.value)
                      if (t) setMakerToken(t)
                    }}
                    className="bg-transparent font-semibold outline-none text-sm"
                  >
                    {[KASPA_TOKEN, ...TOKENS].map(t => (
                      <option key={t.ticker} value={t.ticker}>{t.ticker}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-center -my-3 relative z-10">
              <div className="w-10 h-10 rounded-xl glass-strong flex items-center justify-center">
                <ArrowLeftRight size={16} className="text-kaspa-pink" />
              </div>
            </div>

            <div className="glass rounded-xl p-4 mb-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-kaspa-muted">You receive</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={takerAmount}
                  onChange={e => /^\d*\.?\d*$/.test(e.target.value) && setTakerAmount(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none placeholder:text-kaspa-green/50"
                />
                <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
                  <span className="text-lg">{takerToken.icon}</span>
                  <select
                    value={takerToken.ticker}
                    onChange={e => {
                      const t = [KASPA_TOKEN, ...TOKENS].find(tk => tk.ticker === e.target.value)
                      if (t) setTakerToken(t)
                    }}
                    className="bg-transparent font-semibold outline-none text-sm"
                  >
                    {[KASPA_TOKEN, ...TOKENS].map(t => (
                      <option key={t.ticker} value={t.ticker}>{t.ticker}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {makerAmount && takerAmount && Number(makerAmount) > 0 && (
              <div className="text-xs text-kaspa-muted text-center py-2">
                Rate: 1 {makerToken.ticker} = {(Number(takerAmount) / Number(makerAmount)).toFixed(6)} {takerToken.ticker}
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setMode("orderbook")} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={handleCreateOffer}
                disabled={!makerAmount || !takerAmount || Number(makerAmount) <= 0 || Number(takerAmount) <= 0}
                className="btn-primary flex-1"
              >
                Post Offer
              </button>
            </div>
          </motion.div>
        )}

        {mode === "accept" && acceptedOffer && (
          <motion.div
            key="accept"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-2xl p-5"
          >
            <h3 className="font-semibold mb-1">Execute Swap</h3>
            <p className="text-xs text-kaspa-muted mb-4">
              Send your tokens directly on-chain to the counterparty.
            </p>

            <div className="glass rounded-xl p-4 mb-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-kaspa-muted">You send</span>
                <span className="font-bold text-kaspa-red">
                  {acceptedOffer.takerAmount} {acceptedOffer.takerToken}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-kaspa-muted">You receive</span>
                <span className="font-bold text-kaspa-green">
                  {acceptedOffer.makerAmount} {acceptedOffer.makerToken}
                </span>
              </div>
              <div className="border-t border-kaspa-border/30 pt-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-kaspa-muted">Send to</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{formatAddress(acceptedOffer.makerAddress)}</span>
                    <button onClick={handleCopy} className="text-kaspa-muted hover:text-white">
                      {copied ? <Check size={12} className="text-kaspa-green" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
                <a
                  href={`https://explorer.kaspa.org/addresses/${acceptedOffer.makerAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-kaspa-pink hover:underline flex items-center gap-1"
                >
                  <ExternalLink size={10} /> View on explorer
                </a>
              </div>
            </div>

            {acceptedOffer.takerToken !== "KAS" && (
              <div className="glass rounded-xl p-3 mb-4 text-xs flex items-start gap-2 border border-kaspa-gold/30">
                <AlertTriangle size={14} className="text-kaspa-gold shrink-0 mt-0.5" />
                <span className="text-kaspa-muted">
                  KRC-20 tokens require a commit-reveal (2 tx). This is not atomic — the counterparty should
                  verify the reveal before releasing KAS.
                </span>
              </div>
            )}

            <AnimatePresence>
              {txStatus === "done" && txId && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="glass rounded-xl p-3 mb-4 text-sm"
                >
                  <div className="flex items-center gap-2 text-kaspa-green font-medium mb-1">
                    <Check size={14} /> Transaction submitted!
                  </div>
                  <p className="text-xs text-kaspa-muted font-mono break-all">
                    TX: <a
                      href={`https://explorer.kaspa.org/transactions/${txId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-kaspa-pink"
                    >{txId}</a>
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {psktHex && (
              <div className="glass rounded-xl p-3 mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-kaspa-muted font-medium">PSKT Hex</span>
                  <button onClick={handleCopyPskt} className="text-kaspa-muted hover:text-white text-xs">
                    {copied ? <Check size={12} className="text-kaspa-green" /> : <Copy size={12} />}
                  </button>
                </div>
                <p className="text-[10px] font-mono text-kaspa-muted break-all max-h-20 overflow-y-auto">
                  {psktHex}
                </p>
              </div>
            )}

            <button
              onClick={executePsktSwap}
              disabled={txStatus === "signing" || txStatus === "broadcasting" || txStatus === "done"}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
            >
              {txStatus === "building" ? "Building transaction..."
                : txStatus === "signing" ? "Signing in KasWare..."
                : txStatus === "broadcasting" ? "Broadcasting..."
                : txStatus === "done" ? "Done ✓"
                : <><Send size={14} /> Send {acceptedOffer.takerToken} via KasWare</>}
            </button>

            {(txStatus === "done") && (
              <button
                onClick={() => { setMode("orderbook"); setAcceptedOffer(null); setTxStatus("idle") }}
                className="btn-secondary w-full mt-2"
              >
                Back to Orderbook
              </button>
            )}
          </motion.div>
        )}

        {mode === "orderbook" && (
          <motion.div
            key="orderbook"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {pairs.map(p => (
                <button
                  key={p}
                  onClick={() => setFilterPair(p)}
                  className={`text-xs whitespace-nowrap px-3 py-1.5 rounded-full transition-all ${
                    filterPair === p
                      ? "bg-kaspa-pink text-white"
                      : "bg-white/5 text-kaspa-muted hover:bg-white/10"
                  }`}
                >
                  {p === "all" ? "All Pairs" : p.replace("_", "/")}
                </button>
              ))}
            </div>

            {loading && offers.length === 0 ? (
              <div className="glass rounded-2xl p-12 text-center text-kaspa-muted text-sm">
                <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                Loading offers...
              </div>
            ) : offers.length === 0 ? (
              <div className="glass rounded-2xl p-12 text-center">
                <ArrowLeftRight size={24} className="text-kaspa-muted mx-auto mb-3" />
                <p className="text-kaspa-muted text-sm mb-1">No open offers</p>
                <p className="text-xs text-kaspa-muted/60 mb-4">
                  Create the first swap offer — all on-chain, no intermediary
                </p>
                <button
                  onClick={() => setMode("create")}
                  className="btn-primary text-sm"
                >
                  Create Offer
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {offers.map((offer) => (
                  <motion.div
                    key={offer.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass rounded-xl p-4 hover:border-kaspa-pink/30 transition-all"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex -space-x-2">
                          <span className="text-lg relative z-10">{getTokenIcon(offer.makerToken)}</span>
                          <span className="text-lg">{getTokenIcon(offer.takerToken)}</span>
                        </div>
                        <div>
                          <div className="font-semibold text-sm">
                            {offer.makerAmount} {offer.makerToken}
                          </div>
                          <div className="text-xs text-kaspa-muted">
                            for {offer.takerAmount} {offer.takerToken}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs text-kaspa-green">
                          {offer.makerPrice.toFixed(6)}
                        </div>
                        <div className="text-[10px] text-kaspa-muted">
                          {offer.usdValue > 0 ? `~$${offer.usdValue.toFixed(2)}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-kaspa-muted">
                        Maker: {formatAddress(offer.makerAddress)}
                      </div>
                      <button
                        onClick={() => handleAccept(offer)}
                        disabled={accepting && acceptingId === offer.id}
                        className="btn-primary text-xs px-4 py-1.5"
                      >
                        {accepting && acceptingId === offer.id ? "Accepting..." : "Accept"}
                      </button>
                    </div>
                  </motion.div>
                ))}
                <p className="text-[10px] text-kaspa-muted text-center pt-2">
                  Refreshing every 15s &middot; {offers.length} offer{offers.length !== 1 ? "s" : ""} open
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-xl p-3 text-sm text-kaspa-red text-center border border-kaspa-red/30"
          >
            {error}
          </motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass rounded-xl p-3 text-sm text-kaspa-green text-center border border-kaspa-green/30"
          >
            {success}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
