export function HealthMeter({ value = 1.87 }: { value?: number }) {
  const pct = Math.min(100, Math.max(0, ((value - 1) / 2) * 100))
  const label = value < 1.25 ? "Danger" : value < 1.75 ? "Caution" : "Healthy"
  const labelTone =
    value < 1.25
      ? "text-[color:var(--crimson)]"
      : value < 1.75
        ? "text-[color:var(--gold-accent)]"
        : "text-[color:var(--emerald-accent)]"

  return (
    <div className="rounded-xl border border-border/60 bg-[oklch(0.16_0.025_265)] p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Health Factor
        </span>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-bold text-foreground">
            {value.toFixed(2)}×
          </span>
          <span className={`font-mono text-[10px] uppercase tracking-wider ${labelTone}`}>
            {label}
          </span>
        </div>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-[oklch(0.11_0.02_265)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: "100%",
            background:
              "linear-gradient(90deg, oklch(0.62 0.24 25) 0%, oklch(0.83 0.16 85) 45%, oklch(0.86 0.2 165) 100%)",
            opacity: 0.25,
          }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-background transition-all duration-500"
          style={{
            left: `calc(${pct}% - 6px)`,
            background:
              value < 1.25
                ? "oklch(0.62 0.24 25)"
                : value < 1.75
                  ? "oklch(0.83 0.16 85)"
                  : "oklch(0.86 0.2 165)",
            boxShadow:
              value < 1.25
                ? "0 0 12px oklch(0.62 0.24 25 / 0.9)"
                : value < 1.75
                  ? "0 0 12px oklch(0.83 0.16 85 / 0.8)"
                  : "0 0 12px oklch(0.86 0.2 165 / 0.9)",
          }}
        />
      </div>
    </div>
  )
}