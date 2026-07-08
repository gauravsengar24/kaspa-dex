import { useMemo } from "react"
import { usePrices } from "../hooks/usePrices"
import { formatUsd } from "../utils/kaspa"

interface OrderbookProps {
  pair: string
}

interface OrderRow {
  price: number
  amount: number
  total: number
}

function generateOrders(base: number, count: number, side: "asks" | "bids"): OrderRow[] {
  const orders: OrderRow[] = []
  for (let i = 0; i < count; i++) {
    const price = side === "asks"
      ? base * (1 + (i + 1) * 0.001)
      : base * (1 - (i + 1) * 0.001)
    const amount = Math.random() * 500 + 10
    orders.push({ price, amount, total: amount * price })
  }
  return orders
}

export default function Orderbook({ pair }: OrderbookProps) {
  const { prices, tokenPrice } = usePrices()

  const tokens = pair.split("_")
  const quoteToken = tokens[1] || tokens[0]
  const baseToken = tokens[0]

  const tp = tokenPrice(quoteToken)
  const midPrice = tp.kas > 0 ? tp.kas : 0.0045
  const midUsd = tp.usd > 0 ? tp.usd : 0
  const inverseRate = midPrice > 0 ? 1 / midPrice : 0

  const asks = useMemo(
    () => generateOrders(midPrice, 8, "asks").sort((a, b) => a.price - b.price),
    [midPrice]
  )
  const bids = useMemo(
    () => generateOrders(midPrice, 8, "bids").sort((a, b) => b.price - a.price),
    [midPrice]
  )

  const maxTotal = useMemo(() => {
    const all = [...asks, ...bids]
    return Math.max(...all.map((o) => o.total), 1)
  }, [asks, bids])

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="p-3 border-b border-kaspa-border/50">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display font-bold text-sm">Orderbook</h3>
          <span className="text-[10px] text-kaspa-muted">{pair.replace("_", "/")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold font-mono text-kaspa-green">{midPrice.toFixed(6)}</span>
          <span className="text-[11px] text-kaspa-muted">~{formatUsd(midUsd)}</span>
        </div>
        <p className="text-[10px] text-kaspa-muted mt-0.5">1 KAS ≈ {inverseRate.toFixed(2)} {quoteToken}</p>
      </div>

      <div className="px-3 pb-1 pt-2">
        <div className="flex justify-between text-[10px] text-kaspa-muted font-medium px-1 mb-1">
          <span>Price ({baseToken})</span>
          <span>Amount</span>
          <span>Total</span>
        </div>

        <div className="space-y-[1px]">
          {asks.map((order, i) => {
            const pct = (order.total / maxTotal) * 100
            return (
              <div key={`ask-${i}`} className="flex justify-between text-[11px] py-[1px] px-1 relative">
                <div className="absolute right-0 top-0 bottom-0 rounded-sm bg-kaspa-red/10" style={{ width: `${pct}%` }} />
                <span className="relative text-kaspa-red font-mono font-medium">{order.price.toFixed(6)}</span>
                <span className="relative text-white/80 font-mono">{order.amount.toFixed(1)}</span>
                <span className="relative text-kaspa-muted font-mono">{order.total.toFixed(2)}</span>
              </div>
            )
          })}
        </div>

        <div className="py-1 text-center border-y border-kaspa-border/20 my-1">
          <span className="text-sm font-bold font-mono text-kaspa-green">{midPrice.toFixed(6)}</span>
          <span className="text-[10px] text-kaspa-muted ml-2">~{formatUsd(midUsd)}</span>
        </div>

        <div className="space-y-[1px]">
          {bids.map((order, i) => {
            const pct = (order.total / maxTotal) * 100
            return (
              <div key={`bid-${i}`} className="flex justify-between text-[11px] py-[1px] px-1 relative">
                <div className="absolute right-0 top-0 bottom-0 rounded-sm bg-kaspa-green/10" style={{ width: `${pct}%` }} />
                <span className="relative text-kaspa-green font-mono font-medium">{order.price.toFixed(6)}</span>
                <span className="relative text-white/80 font-mono">{order.amount.toFixed(1)}</span>
                <span className="relative text-kaspa-muted font-mono">{order.total.toFixed(2)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
