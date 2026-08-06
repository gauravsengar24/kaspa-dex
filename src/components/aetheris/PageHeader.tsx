import type { ReactNode } from "react"

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--emerald-accent)]">
          {eyebrow}
        </div>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl font-mono text-[11px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  )
}