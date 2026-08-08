import { useEffect, useMemo, useState } from "react"
import { fetchTrades } from "../../utils/kascov"
import type { Kcc20Token } from "../../utils/kcc20"

const SOMPI = 100_000_000

function fmtUsd(p: number): string {
  if (p >= 1000) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 })
  if (p >= 1) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 2 })
  if (p >= 0.01) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 4 })
  return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 6 })
}

interface Point {
  t: number
  p: number
}

export function LivePriceChart({
  token,
  pairLabel,
  kasUsd,
  height = 220,
  refreshMs = 15_000,
}: {
  token: Kcc20Token | null | undefined
  pairLabel: string
  kasUsd: number
  height?: number
  refreshMs?: number
}) {
  const [points, setPoints] = useState<Point[]>([])

  useEffect(() => {
    if (!token?.covenantId) {
      setPoints([])
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const trades = await fetchTrades({ tokenId: token.covenantId, limit: 250 })
        if (cancelled) return
        const rows: Point[] = trades
          .filter((t) => t.baseAmount > 0 && t.quoteSompi > 0)
          .map((t) => ({
            t: t.acceptingTimeMs || Date.now(),
            p: ((t.quoteSompi / SOMPI) * (kasUsd > 0 ? kasUsd : 1)) / t.baseAmount,
          }))
          .reverse()
        if (rows.length) setPoints(rows)
      } catch {
        /* kascov unreachable — keep last frame */
      }
    }
    void load()
    const timer = setInterval(() => void load(), refreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [token?.covenantId, kasUsd, refreshMs])

  const series = useMemo(() => {
    if (points.length < 2) return points
    const bin = Math.max(1, Math.floor(points.length / 90))
    const out: Point[] = []
    for (let i = 0; i < points.length; i += bin) {
      const slice = points.slice(i, i + bin)
      out.push(slice[slice.length - 1])
    }
    return out
  }, [points])

  const { area, path, min, max, first, last, up } = useMemo(() => {
    const empty = { area: "", path: "", min: 0, max: 0, first: 0, last: 0, up: true }
    if (series.length < 2) return empty
    const W = 420
    const H = height - 34
    const vals = series.map((s) => s.p)
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const span = hi - lo || Math.abs(lo || 1)
    const min = lo - span * 0.08
    const max = hi + span * 0.08
    const range = max - min || 1
    const px = (i: number) => (i / (series.length - 1)) * W
    const py = (v: number) => H - ((v - min) / range) * H
    const pts = series.map((s, i) => `${px(i).toFixed(1)},${py(s.p).toFixed(1)}`).join(" ")
    return {
      area: `0,${H} ${pts} ${W},${H}`,
      path: pts,
      min,
      max,
      first: series[0].p,
      last: series[series.length - 1].p,
      up: series[series.length - 1].p >= series[0].p,
    }
  }, [series, height])

  const paired = series.length >= 2 && max > 0
  const color = up ? "var(--emerald-accent)" : "var(--crimson)"
  const pct = first > 0 ? ((last - first) / first) * 100 : 0
  const lastPosY = paired ? height - 34 - ((last - min) / (max - min || 1)) * (height - 34) : 0

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{pairLabel}</div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold" style={{ color: paired ? color : undefined }}>
              {paired ? fmtUsd(last) : "—"}
            </span>
            {paired && (
              <span className={`font-mono text-[11px] font-semibold ${up ? "text-[color:var(--emerald-accent)]" : "text-[color:var(--crimson)]"}`}>
                {up ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
              </span>
            )}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {paired ? `${series.length} trades · last ${points.length} · kascov live` : "kascov live price feed"}
          </div>
        </div>
        <div className="flex gap-2 font-mono text-[10px] text-muted-foreground">
          <span className="rounded-md border border-border/50 px-1.5 py-0.5">H {fmtUsd(max)}</span>
          <span className="rounded-md border border-border/50 px-1.5 py-0.5">L {fmtUsd(min)}</span>
        </div>
      </div>

      <div className="relative" style={{ height }}>
        {paired ? (
          <svg width="100%" height={height} viewBox={`0 0 420 ${height}`} preserveAspectRatio="none" className="overflow-visible">
            <defs>
              <linearGradient id="lpc-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1="0" x2="420" y1={(height - 34) * f + 8} y2={(height - 34) * f + 8} stroke="var(--border)" strokeOpacity="0.25" strokeDasharray="3 4" />
            ))}
            <polygon points={area} fill="url(#lpc-area)" />
            <polyline points={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={420 - 2} cy={lastPosY} r={4} fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
          </svg>
        ) : (
          <div className="grid h-full place-items-center">
            <span className="font-mono text-[11px] text-muted-foreground">No trades yet for this pair</span>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span>{paired ? new Date(series[0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
          <span>{paired ? "price · KASCov live" : "kascov.io"}</span>
          <span>{paired ? new Date(series[series.length - 1].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
        </div>
      </div>
    </div>
  )
}