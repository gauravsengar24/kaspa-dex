import { useEffect, useMemo, useRef, useState } from "react"
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

const INDICATORS = [
  { id: "sma", label: "SMA", fields: [7, 25, 99] },
  { id: "ema", label: "EMA", fields: [9, 21, 50] },
  { id: "rsi", label: "RSI 14", fields: [14] },
] as const

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

function emaArr(vals: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null)
  if (vals.length < n) return out
  let sum = 0
  for (let i = 0; i < n; i++) sum += vals[i]
  let prev = sum / n
  out[n - 1] = prev
  const k = 2 / (n + 1)
  for (let i = n; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

function smaArr(vals: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null)
  if (vals.length < n) return out
  let sum = 0
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i]
    if (i >= n) sum -= vals[i - n]
    if (i >= n - 1) out[i] = sum / n
  }
  return out
}

function rsiArr(vals: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null)
  if (vals.length < n + 1) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= n; i++) {
    const d = vals[i] - vals[i - 1]
    if (d > 0) gain += d
    else loss -= d
  }
  let avgG = gain / n
  let avgL = loss / n
  out[n] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
  for (let i = n + 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1]
    avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n
    avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
  }
  return out
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export function LivePriceChart({
  token,
  pair,
  height = 300,
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
  const [viewStart, setViewStart] = useState(0)
  const [viewCount, setViewCount] = useState(0)
  const [mode, setMode] = useState<"candles" | "line">("candles")
  const [ta, setTa] = useState<Record<string, boolean>>({ sma: true, ema: false, rsi: false })
  const [taOpen, setTaOpen] = useState(false)

  const inverted = pair.base === "KAS" && pair.quote !== "KAS"

  // raw candle fetch (with deep cursor pagination)
  useEffect(() => {
    if (!token?.covenantId) {
      setCandles([])
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const bucketMs = TIMEFRAMES.find((t) => t.label === tf)?.ms ?? 900_000
        const oldestT = Date.now() - bucketMs * 220
        const rows: { t: number; p: number; v: number }[] = []
        let cursor: { daa: number; seq: number; token: string } | null = null
        for (let page = 0; page < 12; page++) {
          const trades = await fetchTrades({
            tokenId: token.covenantId,
            limit: 250,
            ...(cursor ? { beforeDaa: cursor.daa, beforeSeq: cursor.seq, beforeToken: cursor.token } : {}),
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
          const oldest = rows[rows.length - 1]
          if (!oldest || oldest.t <= oldestT) break
          const tTail = trades[trades.length - 1]
          cursor = { daa: tTail.acceptingDaa, seq: tTail.seq, token: token.covenantId }
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
        setCandles(out.slice(-200))
        setViewStart(0)
        setViewCount(out.length)
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
    return candles.map((c) => ({ t: c.t, o: inv(c.o), h: inv(c.l), l: inv(c.h), c: inv(c.c), v: c.v }))
  }, [candles, inverted])

  const n = series.length
  useEffect(() => {
    if (viewCount > 0) return
    setViewCount(n)
    setViewStart(0)
  }, [n, viewCount])

  const vc = clamp(viewCount, 8, Math.max(8, n || 8))
  const vs = clamp(viewStart, 0, Math.max(0, n - vc))
  const vis: Candle[] = vc >= n ? series : series.slice(vs, vs + vc)
  const visibleIdx = (gi: number): number => gi - vs

  // value bounds over the visible window (incl. overlays so lines clamp fully)
  const { min, max, volHi, first, last, up, lo, hi } = useMemo(() => {
    if (!vis.length) return { min: 0, max: 1, volHi: 1, first: 0, last: 0, up: true, lo: 0, hi: 0 }
    let lo = Infinity
    let hi = -Infinity
    for (const c of vis) {
      if (c.l < lo) lo = c.l
      if (c.h > hi) hi = c.h
    }
    const span = hi - lo || Math.abs(hi || 1)
    const pad = span * 0.12
    const lastC = vis[vis.length - 1]
    return {
      min: lo - pad,
      max: hi + pad,
      volHi: Math.max(...vis.map((c) => c.v), 0.0001),
      first: vis[0].o,
      last: lastC.c,
      up: lastC.c >= vis[0].o,
      lo,
      hi,
    }
  }, [vis])

  const closes = useMemo(() => vis.map((c) => c.c), [vis])
  const inds = useMemo(() => {
    const map: Record<string, (number | null)[]> = {}
    for (const ind of INDICATORS) {
      if (!ta[ind.id]) continue
      for (const f of ind.id === "rsi" ? ind.fields : ind.fields) {
        const vals = ind.id === "sma" ? smaArr(closes, f) : ind.id === "ema" ? emaArr(closes, f) : rsiArr(closes, f)
        map[`${ind.id}:${f}`] = ind.id === "rsi" ? rsiArr(closes, f) : vals
      }
    }
    return map
  }, [closes, ta])

  const W = 440
  const priceH = height - (ta.rsi ? 106 : 76)
  const volTop = priceH + 4
  const volH = 26
  const rsiTop = volTop + 10 + volH
  const rsiH = 18
  const step = vis.length > 1 ? W / vis.length : W
  const bw = Math.max(2, step * 0.62)

  const x = (gi: number): number => visibleIdx(gi) * step + step / 2
  const y = (v: number): number => (max === min ? 8 : priceH - ((v - min) / (max - min)) * (priceH - 16) + 8)
  const rsiY = (v: number): number => rsiTop + rsiH - (clamp(v, 0, 100) / 100) * rsiH

  const overlayColor: Record<string, string> = {
    "sma:7": "oklch(0.75 0.15 240)",
    "sma:25": "oklch(0.7 0.13 80)",
    "sma:99": "oklch(0.7 0.1 320)",
    "ema:9": "oklch(0.85 0.2 165)",
    "ema:21": "oklch(0.8 0.17 290)",
    "ema:50": "oklch(0.78 0.14 40)",
  }

  const hoverG = hover != null ? vs + clamp(hover, 0, vis.length - 1) : null
  const hoverCandle = hoverG != null && series[hoverG] ? series[hoverG] : null
  const headerPair = `${pair.base} / ${pair.quote}`

  const wheelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wheelRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const fx = clamp((e.clientX - rect.left) / rect.width, 0, 1)
      const anchor = vs + fx * vc
      const factor = e.deltaY > 0 ? 1.25 : 0.8
      const newCount = clamp(Math.round(vc * factor), 8, Math.max(8, n))
      const newStart = clamp(Math.round(anchor - fx * newCount), 0, Math.max(0, n - newCount))
      setViewCount(newCount)
      setViewStart(newStart)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [vs, vc, n])

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
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {headerPair}
              {inverted ? " · inverted (1 KAS)" : ""}
            </span>
          </div>
          {hoverCandle ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[11px]">
              <span className="font-display text-xl font-bold text-foreground">{fmtPrice(hoverCandle.c)}</span>
              <span className="text-muted-foreground">O {fmtPrice(hoverCandle.o)}</span>
              <span className="text-[color:var(--emerald-accent)]">H {fmtPrice(hoverCandle.h)}</span>
              <span className="text-[color:var(--crimson)]">L {fmtPrice(hoverCandle.l)}</span>
              <span className="text-muted-foreground">C {fmtPrice(hoverCandle.c)}</span>
              <span className="text-muted-foreground">{new Date(hoverCandle.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold" style={{ color: last >= first ? "var(--emerald-accent)" : "var(--crimson)" }}>
                {fmtPrice(last)}
              </span>
              {first !== 0 && (
                <span className={`font-mono text-[11px] font-semibold ${last >= first ? "text-[color:var(--emerald-accent)]" : "text-[color:var(--crimson)]"}`}>
                  {last >= first ? "▲" : "▼"} {Math.abs(((last - first) / first) * 100).toFixed(2)}%
                </span>
              )}
              <span className="font-mono text-[10px] text-muted-foreground">
                H {fmtPrice(hi)} · L {fmtPrice(lo)}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
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
          <div className="mx-1 h-4 w-px bg-border/60" />
          <div className="flex gap-1">
            {(["candles", "line"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-1.5 py-1 font-mono text-[10px] capitalize transition-colors ${
                  mode === m ? "bg-[color:var(--emerald-accent)]/15 text-[color:var(--emerald-accent)]" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "candles" ? "Candle" : "Line"}
              </button>
            ))}
          </div>
          <div className="mx-1 h-4 w-px bg-[color:var(--border)]/60" />
          <div className="relative">
            <button
              type="button"
              onClick={() => setTaOpen((o) => !o)}
              className={`rounded-md px-1.5 py-1 font-mono text-[10px] transition-colors ${Object.values(ta).some(Boolean) ? "text-[color:var(--emerald-accent)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              IND
            </button>
            {taOpen && (
              <div className="absolute right-0 top-6 z-20 w-40 rounded-lg border border-border/60 bg-[oklch(0.12_0.02_265)]/95 p-2 shadow-xl backdrop-blur">
                {INDICATORS.map((ind) => (
                  <label key={ind.id} className="flex cursor-pointer items-center justify-between px-1 py-1.5 font-mono text-[11px] text-foreground">
                    <span>{ind.label}</span>
                    <input
                      type="checkbox"
                      checked={!!ta[ind.id]}
                      onChange={(e) => setTa((s) => ({ ...s, [ind.id]: e.target.checked }))}
                      className="accent-[color:var(--emerald-accent)]"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={wheelRef} className="relative rounded-lg border border-border/40 bg-[oklch(0.09_0.015_265)]/40">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="block cursor-crosshair touch-none overflow-visible"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const x = ((e.clientX - rect.left) / rect.width) * W
            const idx = clamp(Math.floor(x / step), 0, Math.max(0, vis.length - 1))
            setHover(idx)
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="lpc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="oklch(0.86 0.2 165)" stopOpacity="0.28" />
              <stop offset="1" stopColor="oklch(0.86 0.2 165)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={priceH * f + 4} y2={priceH * f + 4} stroke="var(--border)" strokeOpacity={f === 0 || f === 1 ? 0.4 : 0.18} strokeDasharray="4 5" />
          ))}

          {mode === "line" ? (
            <g>
              <polygon fill="url(#lpc-area)" points={`0,${priceH} ${vis.map((c, i) => `${x(vs + i)},${y(c.c).toFixed(1)}`).join(" ")} ${W},${priceH}`} />
              <polyline points={vis.map((c, i) => `${x(vs + i)},${y(c.c).toFixed(1)}`).join(" ")} fill="none" stroke="oklch(0.86 0.2 165)" strokeWidth={1.6} />
            </g>
          ) : (
            vis.map((c, i) => {
              const gi = vs + i
              const cx = x(gi)
              const up = c.c >= c.o
              const col = up ? "oklch(0.86 0.2 165)" : "oklch(0.6 0.24 20)"
              const bodyTop = Math.min(y(c.o), y(c.c))
              const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)))
              const volBar = Math.max(1, volH * (c.v / volHi))
              return (
                <g key={gi} opacity={hover === i ? 1 : 0.92}>
                  <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
                  <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={col} />
                  <rect x={i * step} y={volTop + volH - volBar} width={Math.max(1, step + 1)} height={volBar} fill={col} opacity={up ? 0.28 : 0.18} />
                </g>
              )
            })
          )}

          {mode === "candles" && ta.sma && Object.entries(inds).filter(([k]) => k.includes("sma")).map(([k, v]) => (
            <polyline key={k} points={v.map((val, i) => (val == null ? "" : `${x(vs + i)},${y(val).toFixed(1)}`)).filter(Boolean).join(" ")} fill="none" stroke={overlayColor[k]} strokeWidth={1} opacity={0.9} />
          ))}
          {mode === "candles" && ta.ema && Object.entries(inds).filter(([k]) => k.includes("ema")).map(([k, v]) => (
            <polyline key={k} points={v.map((val, i) => (val == null ? "" : `${x(vs + i)},${y(val).toFixed(1)}`)).filter(Boolean).join(" ")} fill="none" stroke={overlayColor[k]} strokeWidth={1.1} opacity={0.95} />
          ))}

          {ta.rsi && (
            <>
              <rect x={0} y={rsiTop} width={W} height={rsiH} fill="oklch(0.14 0.02 265 / 0.5)" />
              <line x1={0} x2={W} y1={rsiY(70)} y2={rsiY(70)} stroke="var(--border)" strokeOpacity={0.3} strokeDasharray="3 4" />
              <line x1={0} x2={W} y1={rsiY(30)} y2={rsiY(30)} stroke="var(--border)" strokeOpacity={0.3} strokeDasharray="3 4" />
              <polyline
                points={inds["rsi:14"] ? inds["rsi:14"].map((val, i) => (val == null ? "" : `${x(vs + i)},${rsiY(val).toFixed(1)}`)).filter(Boolean).join(" ") : ""}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth={1.1}
              />
              <text x={2} y={rsiTop + 9} fill="var(--muted-foreground)" fontSize={8} fontFamily="var(--font-mono, monospace)">RSI 14</text>
              <text x={W - 2} y={rsiY(70) - 2} fill="var(--muted-foreground)" fontSize={7} textAnchor="end">70</text>
              <text x={W - 2} y={rsiY(50) + 8} fill="var(--muted-foreground)" fontSize={7} textAnchor="end">50</text>
              <text x={W - 2} y={rsiY(30) + 8} fill="var(--muted-foreground)" fontSize={7} textAnchor="end">30</text>
            </>
          )}

          {hover !== null && (
            <line x1={x(vs + hover)} x2={x(vs + hover)} y1={2} y2={volTop} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="3 4" />
          )}

          {[0.25, 0.5, 0.75].map((f) => {
            const gy = priceH * f + 4
            const v = max - (max - min) * f
            return (
              <text key={f} x={W - 2} y={gy + 9} textAnchor="end" fill="var(--muted-foreground)" fontSize={9} fontFamily="var(--font-mono, monospace)">
                {fmtPrice(inverted ? inv(v) : v)}
              </text>
            )
          })}

          <line x1="0" x2={W} y1={volTop} y2={volTop} stroke="var(--border)" strokeOpacity={0.5} />
          <text x={2} y={volTop + 10} fill="var(--muted-foreground)" fontSize={8} fontFamily="var(--font-mono, monospace)">VOL</text>
        </svg>
      </div>

      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>{vis.length ? new Date(vis[0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
        <span>kascov live · {n} candles · scroll to zoom</span>
        <span>{vis.length ? new Date(vis[vis.length - 1].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
      </div>
    </div>
  )
}