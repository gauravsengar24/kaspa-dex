import { useEffect, useMemo, useState } from "react"
import { fetchTrades } from "../../utils/kascov"
import type { Kcc20Token } from "../../utils/kcc20"

const SOMPI = 100_000_000

const TIMEFRAMES = [
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
  { label: "15m", ms: 900_000 },
  { label: "1h", ms: 3_600_000 },
  { label: "4h", ms: 14_400_000 },
  { label: "12h", ms: 43_200_000 },
  { label: "1D", ms: 86_400_000 },
]

interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—"
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 })
  if (p >= 1) return p.toLocaleString("en-US", { maximumFractionDigits: 4 })
  if (p >= 0.01) return p.toLocaleString("en-US", { maximumFractionDigits: 6 })
  return p.toLocaleString("en-US", { maximumFractionDigits: 8 })
}

const inv = (v: number): number => (Number.isFinite(v) && v > 0 ? 1 / v : 0)

export function LivePriceChart({
  token,
  pair,
  height = 240,
  refreshMs = 15_000,
}: {
  token: Kcc20Token | null | undefined
  pair: { base: string; quote: string }
  height?: number
  refreshMs?: number
}) {
  const [tf, setTf] = useState<string>("15m")
  const [candles, setCandles] = useState<Candle[]>([])
  const [hover, setHover] = useState<number | null>(null)

  const inverted = pair.base === "KAS" && pair.quote !== "KAS"

  useEffect(() => {
    if (!token?.covenantId) {
      setCandles([])
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const bucketMs = TIMEFRAMES.find((t) => t.label === tf)?.ms ?? 900_000
        const oldestT = Date.now() - bucketMs * 120
        const rows: { t: number; p: number; v: number }[] = []
        let beforeSeq: number | undefined
        for (let page = 0; page < 6; page++) {
          const trades = await fetchTrades({
            tokenId: token.covenantId,
            limit: 250,
            ...(beforeSeq != null ? { beforeSeq, beforeToken: token.covenantId } : {}),
          })
          if (!trades.length) break
          for (const tr of trades) {
            if (tr.baseAmount > 0 && tr.quoteSompi > 0) {
              rows.push({
                t: tr.acceptingTimeMs || Date.now(),
                p: tr.quoteSompi / SOMPI / tr.baseAmount,
                v: tr.quoteSompi / SOMPI,
              })
            }
          }
          const last = rows[rows.length - 1]
          if (!last || last.t <= oldestT) break
          beforeSeq = trades[trades.length - 1]?.seq ?? undefined
        }
        if (cancelled) return
        rows.sort((a, b) => a.t - b.t)
        const byKey = new Map<number, Candle>()
        const out: Candle[] = []
        for (const r of rows) {
          const key = Math.floor(r.t / bucketMs) * bucketMs
          const a = byKey.get(key)
          if (!a) {
            const c: Candle = { t: key, o: r.p, h: r.p, l: r.p, c: r.p, v: r.v }
            byKey.set(key, c)
            out.push(c)
          } else {
            a.h = Math.max(a.h, r.p)
            a.l = Math.min(a.l, r.p)
            a.c = r.p
            a.v += r.v
          }
        }
        out.sort((a, b) => a.t - b.t)
        setCandles(out.slice(-150))
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
  }, [token?.covenantId, tf, refreshMs])

  const series = useMemo(() => {
    if (!inverted) return candles
    return candles.map((c) => ({
      t: c.t,
      o: inv(c.o),
      h: inv(c.l),
      l: inv(c.h),
      c: inv(c.c),
      v: c.v,
    }))
  }, [candles, inverted])

  const bounds = useMemo(() => {
    if (series.length < 2) return { min: 0, max: 1, hi: 0, lo: 0, first: 0, last: 0, up: true, volHi: 1 }
    const los = series.map((c) => c.l)
    const his = series.map((c) => c.h)
    const lo = Math.min(...los)
    const hi = Math.max(...his)
    const span = hi - lo || Math.abs(hi || 1)
    const pad = span * 0.1
    const lastC = series[series.length - 1]
    return {
      min: lo - pad,
      max: hi + pad,
      hi,
      lo,
      first: series[0].o,
      last: lastC.c,
      up: lastC.c >= series[0].o,
      volHi: Math.max(...series.map((c) => c.v), 0.001),
    }
  }, [series])

  const W = 420
  const priceH = height - 58
  const volTop = priceH + 4
  const volH = 24
  const n = series.length
  const step = n > 1 ? W / n : W
  const bw = Math.max(2, step * 0.6)

  const y = (v: number): number =>
    bounds.max === bounds.min ? 8 : priceH - ((v - bounds.min) / (bounds.max - bounds.min)) * (priceH - 16) + 8

  const hoverCandle = hover != null && series[hover] ? series[hover] : null

  const headerPair = `${pair.base} / ${pair.quote}`

  if (!token?.covenantId) {
    return (
      <div className="w-full">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{headerPair}</div>
        <div className="grid place-items-center rounded-lg border border-border/40" style={{ height }}>
          <span className="font-mono text-[11px] text-muted-foreground">No market data for this pair yet</span>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {headerPair}
            {inverted ? " · inverted (1 KAS)" : ""}
          </div>
          {hoverCandle ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <span className="font-display text-xl font-bold text-foreground">{fmtPrice(hoverCandle.c)}</span>
              <span className="text-muted-foreground">O {fmtPrice(hoverCandle.o)}</span>
              <span className="text-[color:var(--emerald-accent)]">H {fmtPrice(hoverCandle.h)}</span>
              <span className="text-[color:var(--crimson)]">L {fmtPrice(hoverCandle.l)}</span>
              <span className="text-muted-foreground">C {fmtPrice(hoverCandle.c)}</span>
              <span className="text-muted-foreground">
                {new Date(hoverCandle.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold" style={{ color: bounds.up ? "var(--emerald-accent)" : "var(--crimson)" }}>
                {fmtPrice(bounds.last)}
              </span>
              {bounds.first !== 0 && (
                <span className={`font-mono text-[11px] font-semibold ${bounds.up ? "text-[color:var(--emerald-accent)]" : "text-[color:var(--crimson)]"}`}>
                  {bounds.up ? "▲" : "▼"} {Math.abs(((bounds.last - bounds.first) / bounds.first) * 100).toFixed(2)}%
                </span>
              )}
              <span className="font-mono text-[10px] text-muted-foreground">
                H {fmtPrice(bounds.hi)} · L {fmtPrice(bounds.lo)}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setTf(t.label)}
              className={`rounded-md px-1.5 py-1 font-mono text-[10px] transition-colors ${
                tf === t.label ? "bg-[color:var(--emerald-accent)]/15 text-[color:var(--emerald-accent)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative rounded-lg border border-border/40 bg-[oklch(0.09_0.015_265)]/40">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="block cursor-crosshair overflow-visible"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const x = ((e.clientX - rect.left) / rect.width) * W
            const idx = Math.floor(x / step)
            setHover(Math.max(0, Math.min(n - 1, idx)))
          }}
          onMouseLeave={() => setHover(null)}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={priceH * f + 4} y2={priceH * f + 4} stroke="var(--border)" strokeOpacity="0.25" strokeDasharray="4 5" />
          ))}

          {series.map((c, i) => {
            const x = i * step + step / 2
            const up = c.c >= c.o
            const col = up ? "oklch(0.86 0.2 165)" : "oklch(0.6 0.24 20)"
            const bodyTop = Math.min(y(c.o), y(c.c))
            const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)))
            const volBar = Math.max(1, volH * (c.v / bounds.volHi))
            return (
              <g key={i} opacity={hover === i ? 1 : 0.92}>
                <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
                <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={col} />
                <rect x={i * step} y={volTop + volH - volBar} width={step + 1} height={volBar} fill={col} opacity={up ? 0.25 : 0.18} />
              </g>
            )
          })}

          {hover != null && (
            <line x1={hover * step + step / 2} x2={hover * step + step / 2} y1={2} y2={volTop} stroke="var(--muted-foreground)" strokeOpacity="0.5" strokeDasharray="3 4" />
          )}

          {[0.25, 0.5, 0.75].map((f) => {
            const gy = priceH * f + 4
            const v = bounds.max - (bounds.max - bounds.min) * f
            return (
              <text key={f} x={W - 4} y={gy + 9} textAnchor="end" fill="var(--muted-foreground)" fontSize={9}>
                {fmtPrice(inverted ? inv(v) : v)}
              </text>
            )
          })}

          <line x1="0" x2={W} y1={volTop} y2={volTop} stroke="var(--border)" strokeOpacity="0.5" />
          <text x={2} y={volTop - 3} fill="var(--muted-foreground)" fontSize={8}>VOL</text>
        </svg>
      </div>

      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>{series.length ? new Date(series[0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
        <span>kascov live · {n} candles · {tf}</span>
        <span>{series.length ? new Date(series[series.length - 1].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
      </div>
    </div>
  )
}