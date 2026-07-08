import { useMemo } from "react"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { TrendingUp, TrendingDown } from "lucide-react"
import { formatUsd } from "../utils/kaspa"

interface PriceChartProps {
  symbol?: string
  currentPrice?: number
  change24h?: number
}

function generateMockHistory(count: number): { time: string; price: number }[] {
  const data = []
  const now = Date.now()
  let price = 0.0295
  for (let i = count; i >= 0; i--) {
    price *= 1 + (Math.random() - 0.5) * 0.004
    const d = new Date(now - i * 3600000)
    data.push({
      time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      price: Number(price.toFixed(6)),
    })
  }
  return data
}

export default function PriceChart({ symbol = "KAS/USD", currentPrice = 0.0295, change24h }: PriceChartProps) {
  const data = useMemo(() => generateMockHistory(48), [])
  const start = data[0]?.price || currentPrice
  const end = data[data.length - 1]?.price || currentPrice
  const isUp = end >= start
  const color = isUp ? "#10b981" : "#ef4444"

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-kaspa-muted font-medium">{symbol}</span>
            {change24h !== undefined && change24h !== 0 && (
              <span className={`flex items-center gap-0.5 text-[11px] ${change24h >= 0 ? "text-kaspa-green" : "text-kaspa-red"}`}>
                {change24h >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                {Math.abs(change24h).toFixed(2)}%
              </span>
            )}
          </div>
          <p className="text-xl font-bold font-mono mt-0.5">{formatUsd(currentPrice)}</p>
        </div>
      </div>

      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6b6580" }} interval="preserveStartEnd" />
            <YAxis domain={["dataMin", "dataMax"]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6b6580" }} orientation="right" width={50} />
            <Tooltip
              contentStyle={{ background: "#1a1628", border: "1px solid #2a2540", borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: "#6b6580" }}
              formatter={(v: number) => [formatUsd(v), "Price"]}
            />
            <Area type="monotone" dataKey="price" stroke={color} strokeWidth={2} fill="url(#gradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
