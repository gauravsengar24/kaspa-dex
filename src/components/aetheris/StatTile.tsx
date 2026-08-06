import type { ComponentType } from "react"
import type { LucideProps } from "lucide-react"

type Tone = "emerald" | "gold" | "violet" | "platinum" | "crimson"

const toneClass: Record<Tone, string> = {
  emerald: "text-[color:var(--emerald-accent)]",
  gold: "text-[color:var(--gold-accent)]",
  violet: "text-[color:var(--violet-accent)]",
  platinum: "text-[color:var(--platinum)]",
  crimson: "text-[color:var(--crimson)]",
}

export function StatTile({
  icon: Icon,
  label,
  value,
  delta,
  tone = "emerald",
}: {
  icon?: ComponentType<LucideProps>
  label: string
  value: string
  delta?: string
  tone?: Tone
}) {
  return (
    <div className="glass glass-border rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className={`h-3.5 w-3.5 ${toneClass[tone]}`} strokeWidth={2.25} />}
      </div>
      <div className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground">
        {value}
      </div>
      {delta && (
        <div className={`mt-1 font-mono text-[11px] ${toneClass[tone]}`}>{delta}</div>
      )}
    </div>
  )
}