import type { ReactNode } from "react"

export type Column<T> = {
  key: string
  header: string
  align?: "left" | "right" | "center"
  width?: string
  render: (row: T) => ReactNode
}

export function DataTable<T extends { id: string | number }>({
  columns,
  rows,
}: {
  columns: Column<T>[]
  rows: T[]
}) {
  const grid = columns.map((c) => c.width ?? "1fr").join(" ")
  const alignFor = (a?: string) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left"

  return (
    <div className="overflow-hidden rounded-xl border border-border/40">
      <div
        className="grid gap-3 border-b border-border/40 bg-[oklch(0.16_0.025_265)]/70 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
        style={{ gridTemplateColumns: grid }}
      >
        {columns.map((c) => (
          <span key={c.key} className={alignFor(c.align)}>
            {c.header}
          </span>
        ))}
      </div>
      <div className="divide-y divide-border/40">
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid items-center gap-3 px-4 py-3 transition-colors hover:bg-[oklch(0.22_0.025_265)]/40"
            style={{ gridTemplateColumns: grid }}
          >
            {columns.map((c) => (
              <div key={c.key} className={`min-w-0 ${alignFor(c.align)}`}>
                {c.render(row)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}