import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Wallet, Copy, Check, ExternalLink, RefreshCw } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatAddress, formatKaspa, formatUsd } from "../utils/kaspa"
import { NETWORK } from "../utils/constants"
import { getBalances, type Kcc20Balance } from "../utils/kcc20"

interface TokenBalance {
  ticker: string
  balance: number
}

export default function WalletPage() {
  const { connected, address, balanceRaw, balanceFormatted, connect, connecting, disconnect, kaswareDetected, error } = useKaspaWallet()
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([])
  const [kcc20Balances, setKcc20Balances] = useState<Kcc20Balance[]>([])
  const [loadingTokens, setLoadingTokens] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchTokenBalances = useCallback(async () => {
    if (!address) return
    setLoadingTokens(true)

    // KCC-20 on-chain balances via the KRON indexer (kron-sdk client).
    try {
      const kcc20 = await getBalances(address)
      setKcc20Balances(kcc20)
    } catch {
      setKcc20Balances([])
    }

    try {
      const resp = await fetch(`${NETWORK.backend}/api/token-balances/${address}`)
      if (resp.ok) {
        const data = await resp.json()
        const balances: TokenBalance[] = []
        for (const [ticker, balance] of Object.entries(data.balances)) {
          if (typeof balance === "number" && balance > 0) {
            balances.push({ ticker, balance })
          }
        }
        setTokenBalances(balances)
      }
    } catch {}
    setLoadingTokens(false)
  }, [address])

  useEffect(() => {
    if (connected && address) {
      fetchTokenBalances()
    }
  }, [connected, address, fetchTokenBalances])

  const handleCopy = () => {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center mb-4">
          <Wallet size={28} className="text-white" />
        </div>
        <h2 className="text-xl font-display font-bold mb-2">Connect Your Wallet</h2>
        <p className="text-sm text-kaspa-muted mb-6 max-w-sm">
          Connect your KasWare wallet to view your KAS balance and credited token balances.
        </p>
        <button onClick={connect} disabled={connecting} className="btn-primary px-8 py-3">
          {connecting ? "Connecting..." : "Connect KasWare"}
        </button>
        {error && <p className="text-sm text-kaspa-red mt-3">{error}</p>}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* KAS Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl p-6"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center">
              <Wallet size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold">KAS Balance</h2>
              <p className="text-xs text-kaspa-muted">On-chain L1 Balance</p>
            </div>
          </div>
          <button onClick={fetchTokenBalances} className="btn-secondary p-2">
            <RefreshCw size={14} className={loadingTokens ? "animate-spin" : ""} />
          </button>
        </div>

        <p className="text-3xl font-bold mb-1">{balanceFormatted} <span className="text-lg text-kaspa-muted">KAS</span></p>

        <div className="flex items-center gap-3 mt-4">
          <div className="glass rounded-lg px-3 py-2 flex items-center gap-2 text-sm">
            <span className="text-kaspa-muted">Address:</span>
            <span className="font-mono text-xs">{formatAddress(address)}</span>
            <button onClick={handleCopy} className="text-kaspa-muted hover:text-white">
              {copied ? <Check size={14} className="text-kaspa-green" /> : <Copy size={14} />}
            </button>
          </div>
          <a
            href={`https://tn12.kaspa.stream/addresses/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-kaspa-muted hover:text-white"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      </motion.div>

      {/* Token Balances Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass rounded-2xl p-6"
      >
        <h3 className="font-display font-bold mb-4">Credited Token Balances</h3>

        {loadingTokens ? (
          <div className="text-sm text-kaspa-muted text-center py-4">Loading...</div>
        ) : tokenBalances.length === 0 && kcc20Balances.length === 0 ? (
          <div className="text-sm text-kaspa-muted text-center py-4">
            No KCC-20 or credited token balances yet.
            <br />Swap KAS for a token on the L1 Swap tab to get started.
          </div>
        ) : (
          <div className="space-y-3">
            {kcc20Balances.slice(0, 8).map((tb) => (
              <div key={tb.tick} className="glass rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-lg">
                    {tb.tick === "USDT" ? "💵" : "🪙"}
                  </div>
                  <div>
                    <p className="font-semibold">{tb.tick}</p>
                    <p className="text-xs text-kaspa-muted">KCC-20 (on-chain)</p>
                  </div>
                </div>
                <p className="text-xl font-bold">{tb.parsed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</p>
              </div>
            ))}
            {tokenBalances.map((tb) => (
              <div key={`${tb.ticker}-credited`} className="glass rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-lg">
                    {tb.ticker === "USDT" ? "💵" : "🪙"}
                  </div>
                  <div>
                    <p className="font-semibold">{tb.ticker}</p>
                    <p className="text-xs text-kaspa-muted">KRC-20 (credited)</p>
                  </div>
                </div>
                <p className="text-xl font-bold">{tb.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</p>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}
