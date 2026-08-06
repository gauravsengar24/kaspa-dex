import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { motion } from "framer-motion"
import { ArrowLeftRight, Check, Lock, RefreshCw, Unlock } from "lucide-react"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatKaspa, formatAddress } from "../utils/kaspa"
import { NETWORK } from "../utils/constants"

const SOMPI_PER_KAS = 100_000_000
const STORAGE_KEY = "kaspadex_active_htlc_order"

interface NetworkInfo {
  dexAddress: string
  kasUsdtRate: number
  network: string
  explorer: string
  covenants?: boolean
  chainDaa: number | null
  timeoutDaa: number
}

interface CovenantOrder {
  id: string
  state: "created" | "funded" | "claimed" | "refunded" | "error"
  network: string
  htlcAddress: string
  amountKas: number
  amountSompi: number
  tokenOut: string
  usdtAmount: number
  secretHash: string
  makerPubkey: string
  timeoutDaa: number
  currentDaa: number
  refundOpen: boolean
  timeRemainingDaa: number
  claimTxId: string | null
  refundTxId: string | null
  makerPrivateKey: string
  explorer: string
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${NETWORK.backend}${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) throw new Error(await resp.text())
  return resp.json() as Promise<T>
}

export default function KaspaL1Swap() {
  const { connected, connect, address, balanceRaw, balanceFormatted, connecting } = useKaspaWallet()
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [kasAmount, setKasAmount] = useState("")
  const [order, setOrder] = useState<CovenantOrder | null>(null)
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch(`${NETWORK.backend}/api/network`)
      .then(r => r.json())
      .then(setNetworkInfo)
      .catch(() => {})
  }, [])

  const restoreOrder = useCallback(async () => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    try {
      const o = await api<CovenantOrder>(`/api/covenant/orders/${saved}`)
      setOrder(o)
      if (o.state === "refunded" || o.state === "claimed") localStorage.removeItem(STORAGE_KEY)
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    restoreOrder()
  }, [restoreOrder])

  useEffect(() => {
    if (!order || order.state === "claimed" || order.state === "refunded") return
    pollRef.current = setInterval(async () => {
      try {
        const fresh = await api<CovenantOrder>(`/api/covenant/orders/${order.id}`)
        setOrder(fresh)
        if (fresh.state === "claimed") {
          setFlash(`Claim confirmed — ${fresh.usdtAmount} ${fresh.tokenOut} credited`)
          localStorage.removeItem(STORAGE_KEY)
        }
        if (fresh.state === "refunded") localStorage.removeItem(STORAGE_KEY)
      } catch { /* backend may be briefly unreachable */ }
    }, 8000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [order?.id, order?.state])

  const usdtAmount = useMemo(() => {
    if (!kasAmount || isNaN(Number(kasAmount)) || Number(kasAmount) <= 0 || !networkInfo) return null
    return Number(kasAmount) * networkInfo.kasUsdtRate
  }, [kasAmount, networkInfo])

  const handleAmountChange = useCallback((value: string) => {
    if (/^\d*\.?\d*$/.test(value)) setKasAmount(value)
  }, [])

  const createOrder = useCallback(async () => {
    if (!connected) { await connect(); return }
    if (!kasAmount || Number(kasAmount) <= 0) return
    setCreating(true)
    setError(null)
    try {
      const created = await api<CovenantOrder>("/api/covenant/orders", {
        maker_address: address,
        amount_kas: Number(kasAmount),
        token_out: "USDT",
      })
      localStorage.setItem(STORAGE_KEY, created.id)
      setOrder(created)
      setFlash(`HTLC order created — send KAS to the covenant address`)
      setKasAmount("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order")
    } finally {
      setCreating(false)
    }
  }, [connected, connect, address, kasAmount])

  const fundHtlc = useCallback(async () => {
    if (!order || !window.kasware) { setError("KasWare wallet not detected"); return }
    setSending(true)
    setError(null)
    try {
      const txId = await window.kasware.sendKaspa(order.htlcAddress, order.amountSompi)
      setFlash(`Funding sent — TX ${txId.slice(0, 12)}...`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding failed")
    } finally {
      setSending(false)
    }
  }, [order])

  const refund = useCallback(async () => {
    if (!order) return
    setRefunding(true)
    setError(null)
    try {
      const result = await api<{ refundTxId: string }>(`/api/covenant/orders/${order.id}/refund`, {
        maker_private_key: order.makerPrivateKey,
      })
      setFlash(`Refunded — TX ${result.refundTxId.slice(0, 12)}...`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund failed")
    } finally {
      setRefunding(false)
    }
  }, [order])

  const insufficientBalance = connected && kasAmount ? Number(kasAmount) > balanceRaw : false
  const countdown = order?.refundOpen
    ? "Refund window open"
    : order
      ? `${Math.round((order.timeRemainingDaa - (order.currentDaa || 0)) / 60)} min until DEX claim window closes`
      : null

  const canCreate = kasAmount && Number(kasAmount) > 0 && !insufficientBalance

  return (
    <div className="max-w-md mx-auto">
      <div className="glass rounded-2xl p-5">
        <div className="mb-4">
          <h2 className="text-lg font-display font-bold">On-Chain Swap</h2>
          <p className="text-xs text-kaspa-muted mt-0.5">
            Trustless HTLC covenant — KAS locked to a script the DEX can only claim by
            revealing a secret on-chain
          </p>
        </div>

        {networkInfo && (
          <div className="glass rounded-xl p-3 mb-4 text-xs text-kaspa-muted space-y-1">
            <div className="flex justify-between">
              <span>Rate</span>
              <span className="text-white">1 KAS = {networkInfo.kasUsdtRate} USDT</span>
            </div>
            <div className="flex justify-between">
              <span>Network</span>
              <span className="text-white">{networkInfo.network}{networkInfo.covenants ? " · covenants on" : ""}</span>
            </div>
          </div>
        )}

        {!order && (
          <>
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
            {insufficientBalance && (
              <div className="text-xs text-kaspa-red text-center mb-2">
                Insufficient KAS balance (you have {balanceFormatted})
              </div>
            )}
            <button
              onClick={createOrder}
              disabled={!canCreate || creating || sending}
              className="btn-primary w-full mt-2"
            >
              {creating ? "Building covenant..." : !connected ? "Connect KasWare" : "Create HTLC order"}
            </button>
          </>
        )}

        {order && (
          <div className="space-y-3">
            <div className="glass rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-kaspa-muted">Order</span>
                <span className="font-mono text-kaspa-pink">{order.id.slice(0, 12)}…</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kaspa-muted">State</span>
                <span className={`font-medium ${order.state === "claimed" ? "text-kaspa-green" : order.state === "refunded" ? "text-kaspa-muted" : "text-white"}`}>
                  {order.state}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kaspa-muted">Locked</span>
                <span className="text-white">{order.amountKas} KAS → {order.usdtAmount} {order.tokenOut}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kaspa-muted">HTLC address</span>
                <span className="font-mono text-xs">{formatAddress(order.htlcAddress)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kaspa-muted">Secret hash</span>
                <span className="font-mono text-xs">{order.secretHash.slice(0, 16)}…</span>
              </div>
              {countdown && (
                <div className="flex items-center justify-between">
                  <span className="text-kaspa-muted">Refund</span>
                  <span className="text-xs">{countdown}</span>
                </div>
              )}
            </div>

            {order.state === "created" && (
              <button onClick={fundHtlc} disabled={sending} className="btn-primary w-full">
                <Lock size={15} className="inline mr-2" />
                {sending ? "Sending to HTLC…" : `Fund HTLC (${order.amountKas} KAS)`}
              </button>
            )}

            {order.state === "funded" && (
              <div className="glass rounded-xl p-3 text-center text-sm text-kaspa-muted">
                Funding confirmed — waiting for the DEX claim to reveal the secret
                <span className="block text-xs mt-1 animate-pulse">watching chain…</span>
              </div>
            )}

            {order.state === "claimed" && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-xl p-3 text-sm bg-kaspa-green/10 border border-kaspa-green/30"
              >
                <div className="flex items-center gap-2 text-kaspa-green font-medium mb-1">
                  <Check size={16} /> Swap complete — secret revealed on-chain
                </div>
                <p className="text-xs text-kaspa-muted">
                  {order.amountKas} KAS → {order.usdtAmount} {order.tokenOut} credited
                </p>
                {order.claimTxId && (
                  <p className="text-xs text-kaspa-muted font-mono truncate">
                    Claim TX: <a
                      href={`${order.explorer}/transactions/${order.claimTxId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-kaspa-pink"
                    >{order.claimTxId.slice(0, 20)}...</a>
                  </p>
                )}
              </motion.div>
            )}

            {order.refundOpen && order.state !== "refunded" && order.state !== "claimed" && (
              <button onClick={refund} disabled={refunding} className="btn-primary w-full opacity-80">
                <Unlock size={15} className="inline mr-2" />
                {refunding ? "Refunding…" : "Refund after timeout"}
              </button>
            )}

            {order.state === "refunded" && (
              <div className="glass rounded-xl p-3 text-sm text-center text-kaspa-muted">
                Order refunded — KAS returned to your wallet
              </div>
            )}
          </div>
        )}

        {flash && (
          <div className="glass rounded-xl p-3 mb-3 text-sm text-center">{flash}</div>
        )}
        {error && (
          <div className="glass rounded-xl p-3 mt-3 text-sm text-kaspa-red text-center">{error}</div>
        )}
      </div>
    </div>
  )
}