type Slice = { label: string; weight: number; color: string }

const slices: Slice[] = [
  { label: "KAS", weight: 60, color: "oklch(0.86 0.2 165)" },
  { label: "AETH", weight: 20, color: "oklch(0.51 0.26 293)" },
  { label: "USDT", weight: 20, color: "oklch(0.83 0.16 85)" },
]

export function PoolWheel() {
  const size = 200
  const r = 78
  const cx = size / 2
  const cy = size / 2
  const C = 2 * Math.PI * r

  let offset = 0
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="oklch(0.22 0.025 265)"
            strokeWidth={18}
          />
          {slices.map((s) => {
            const len = (s.weight / 100) * C
            const el = (
              <circle
                key={s.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={18}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                style={{ filter: `drop-shadow(0 0 6px ${s.color})` }}
              />
            )
            offset += len
            return el
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
              Pool APR
            </div>
            <div className="font-display text-2xl font-bold text-[color:var(--emerald-accent)]">
              24.8%
            </div>
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-1.5">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }}
              />
              <span className="font-mono text-muted-foreground">{s.label}</span>
            </div>
            <span className="font-mono font-semibold text-foreground">{s.weight}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}