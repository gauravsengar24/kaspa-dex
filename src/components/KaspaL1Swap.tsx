import { useState, useCallback, useEffect, useMemo } from "react"
import { motion } from "framer-motion"
import { ArrowLeftRight, Check } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatKaspa, formatAddress } from "../utils/kaspa"
import { NETWORK } from "../utils/constants"

const SOMPI_PER_KAS = 100_000_000

interface NetworkInfo {
  dexAddress: string
  kasUsdtRate: number
  network: string
  explorer: string
}

export default function KaspaL1Swap() {
  const { connected, connect, address, balanceRaw, balanceFormatted, connecting } = useKaspaWallet()
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [kasAmount, setKasAmount] = useState("")
  const [swapping, setSwapping] = useState(false)
  const [txResult, setTxResult] = useState<{ txId: string; usdtAmount: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    fetch(`${NETWORK.backend}/api/network`)
      .then(r => r.json())
      .then(setNetworkInfo)
      .catch(() => {})
  }, [])

  const usdtAmount = useMemo(() => {
    if (!kasAmount || isNaN(Number(kasAmount)) || Number(kasAmount) <= 0) return null
    if (!networkInfo) return null
    return Number(kasAmount) * networkInfo.kasUsdtRate
  }, [kasAmount, networkInfo])

  const handleAmountChange = useCallback((value: string) => {
    if (/^\d*\.?\d*$/.test(value)) setKasAmount(value)
  }, [])

  const handleSwap = useCallback(async () => {
    if (!connected) {
      await connect()
      return
    }
    if (!kasAmount || Number(kasAmount) <= 0 || !networkInfo) return
    if (!window.kasware) { setError("KasWare wallet not detected"); return }

    setSwapping(true)
    setError(null)
    setTxResult(null)
    setShowSuccess(false)

    try {
      const sompi = Math.floor(Number(kasAmount) * SOMPI_PER_KAS)
      const provider = window.kasware

      const txId = await provider.sendKaspa(networkInfo.dexAddress, sompi)
      const usdtAmountOut = Number(kasAmount) * networkInfo.kasUsdtRate

      const logResp = await fetch(`${NETWORK.backend}/api/log-swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          token_out: "USDT",
          amount_out: usdtAmountOut,
          tx_id: txId,
        }),
      })

      if (!logResp.ok) {
        const errBody = await logResp.text()
        throw new Error(`Backend error: ${errBody}`)
      }

      setTxResult({ txId, usdtAmount: usdtAmountOut })
      setShowSuccess(true)
      setKasAmount("")

      setTimeout(() => setShowSuccess(false), 8000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed")
    } finally {
      setSwapping(false)
    }
  }, [connected, connect, kasAmount, networkInfo, address])

  const insufficientBalance = connected && kasAmount ? Number(kasAmount) > balanceRaw : false
  const hasValidInput = kasAmount && Number(kasAmount) > 0 && !insufficientBalance

  return (
    <div className="max-w-md mx-auto">
      <div className="glass rounded-2xl p-5">
        <div className="mb-4">
          <h2 className="text-lg font-display font-bold">L1 Swap</h2>
          <p className="text-xs text-kaspa-muted mt-0.5">Direct Kaspa L1 KAS → USDT</p>
        </div>

        {networkInfo && (
          <div className="glass rounded-xl p-3 mb-4 text-xs text-kaspa-muted space-y-1">
            <div className="flex justify-between">
              <span>Rate</span>
              <span className="text-white">1 KAS = {networkInfo.kasUsdtRate} USDT</span>
            </div>
            <div className="flex justify-between">
              <span>DEX</span>
              <span className="font-mono">{formatAddress(networkInfo.dexAddress)}</span>
            </div>
          </div>
        )}

        <div className="glass rounded-xl p-4 mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-kaspa-muted">You send</span>
            <span className="text-xs text-kaspa-muted">
              Balance: {connected ? balanceFormatted : "—"} KAS
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={kasAmount}
              onChange={e => handleAmountChange(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none"
            />
            <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
              <span className="font-semibold">KAS</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center -my-3 relative z-10">
          <div className="w-10 h-10 rounded-xl glass-strong border-4 border-kaspa-dark flex items-center justify-center">
            <ArrowLeftRight size={18} className="text-kaspa-pink" />
          </div>
        </div>

        <div className="glass rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-kaspa-muted">You receive</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={usdtAmount !== null ? usdtAmount.toFixed(2) : ""}
              readOnly
              placeholder="0.0"
              className="flex-1 bg-transparent border-0 p-0 text-2xl font-bold outline-none text-kaspa-green"
            />
            <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
              <span className="font-semibold">USDT</span>
            </div>
          </div>
        </div>

        {showSuccess && txResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-xl p-3 mb-3 text-sm bg-kaspa-green/10 border border-kaspa-green/30"
          >
            <div className="flex items-center gap-2 text-kaspa-green font-medium mb-1">
              <Check size={16} /> Swap successful!
            </div>
            <p className="text-xs text-kaspa-muted">
              {kasAmount} KAS → {txResult.usdtAmount.toFixed(2)} USDT
            </p>
            <p className="text-xs text-kaspa-muted font-mono truncate">
              TX: <a
                href={`${networkInfo?.explorer || "https://explorer.kaspa.org"}/transactions/${txResult.txId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-kaspa-pink"
              >{txResult.txId.slice(0, 20)}...</a>
            </p>
          </motion.div>
        )}

        {error && (
          <div className="glass rounded-xl p-3 mb-3 text-sm text-kaspa-red text-center">
            {error}
          </div>
        )}

        {insufficientBalance && (
          <div className="text-xs text-kaspa-red text-center mb-2">
            Insufficient KAS balance (you have {balanceFormatted})
          </div>
        )}

        <button
          onClick={handleSwap}
          disabled={!hasValidInput || swapping || connecting}
          className="btn-primary w-full mt-2"
        >
          {swapping
            ? "Sending..."
            : connecting
              ? "Connecting..."
              : !connected
                ? "Connect KasWare"
                : insufficientBalance
                  ? "Insufficient KAS"
                  : !hasValidInput
                    ? "Enter amount"
                    : `Swap KAS → USDT`}
        </button>
      </div>
    </div>
  )
}
