import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

export type ActionDialogProps = {
  open: boolean
  onClose: () => void
  eyebrow: string
  title: string
  token?: string
  balanceLabel?: string
  maxAmount?: number
  confirmLabel: string
  tone?: "emerald" | "gold" | "violet" | "crimson"
  details?: [string, string][]
  extra?: ReactNode
  onConfirm: (amount: number) => void
}

const toneVar = {
  emerald: "var(--emerald-accent)",
  gold: "var(--gold-accent)",
  violet: "var(--violet-accent)",
  crimson: "var(--crimson)",
} as const

export function ActionDialog({
  open,
  onClose,
  eyebrow,
  title,
  token,
  balanceLabel,
  maxAmount = 0,
  confirmLabel,
  tone = "emerald",
  details = [],
  extra,
  onConfirm,
}: ActionDialogProps) {
  const [value, setValue] = useState("")
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (open) setValue("")
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open || !mounted) return null

  const amount = Number(value.replace(/,/g, ""))
  const valid = Number.isFinite(amount) && amount > 0 && (maxAmount <= 0 || amount <= maxAmount)
  const accent = toneVar[tone]

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[oklch(0.08_0.015_265)]/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="glass glass-border w-full max-w-md rounded-2xl p-6 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {eyebrow}
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="recessed rounded-xl p-4">
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Amount</span>
            {balanceLabel && <span>{balanceLabel}</span>}
          </div>
          <div className="flex items-center gap-3">
            <input
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
              className="w-full min-w-0 bg-transparent font-display text-3xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
            />
            {token && (
              <span className="shrink-0 font-display text-sm font-semibold text-muted-foreground">
                {token}
              </span>
            )}
          </div>
          {maxAmount > 0 && (
            <div className="mt-2 flex gap-1.5">
              {[0.25, 0.5, 0.75, 1].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setValue(String(+(maxAmount * p).toFixed(4)))}
                  className="rounded-md border border-border/60 px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  {p === 1 ? "Max" : `${p * 100}%`}
                </button>
              ))}
            </div>
          )}
        </div>

        {details.length > 0 && (
          <div className="mt-3 space-y-1.5 rounded-xl border border-border/50 bg-[oklch(0.11_0.02_265)]/60 p-3 font-mono text-[11px]">
            {details.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-right text-foreground">{v}</span>
              </div>
            ))}
          </div>
        )}

        {extra && <div className="mt-3">{extra}</div>}

        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            onConfirm(amount)
            onClose()
          }}
          className="mt-4 w-full rounded-xl py-3 font-display text-sm font-bold text-[color:var(--onyx)] transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:-translate-y-0.5"
          style={{ background: `color-mix(in oklab, ${accent} 100%, transparent)` }}
        >
          {valid ? confirmLabel : maxAmount > 0 && amount > maxAmount ? "Insufficient balance" : "Enter an amount"}
        </button>
      </div>
    </div>,
    document.body,
  )
}