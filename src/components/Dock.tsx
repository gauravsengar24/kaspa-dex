import { useRef, useState, type ComponentType } from "react"
import { type LucideProps } from "lucide-react"

type DockItem = {
  id: string
  label: string
  icon: ComponentType<LucideProps>
  tone: "emerald" | "gold" | "violet" | "platinum"
}

const toneRing: Record<DockItem["tone"], string> = {
  emerald: "text-[color:var(--emerald-accent)]",
  gold: "text-[color:var(--gold-accent)]",
  violet: "text-[color:var(--violet-accent)]",
  platinum: "text-[color:var(--platinum)]",
}

const toneGlow: Record<DockItem["tone"], string> = {
  emerald: "shadow-[0_0_20px_-2px_oklch(0.86_0.2_165/0.6)]",
  gold: "shadow-[0_0_20px_-2px_oklch(0.83_0.16_85/0.55)]",
  violet: "shadow-[0_0_20px_-2px_oklch(0.51_0.26_293/0.6)]",
  platinum: "shadow-[0_0_16px_-2px_oklch(0.72_0.03_250/0.35)]",
}

const BASE = 44
const MAX = 68
const NEAR = 58
const NEAR2 = 50

interface DockProps {
  items: DockItem[]
  trailing?: DockItem[]
  activeTab: string
  onTabChange: (id: string) => void
}

export default function Dock({ items, trailing = [], activeTab, onTabChange }: DockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const sizeFor = (i: number) => {
    if (hoverIndex === null) return BASE
    const d = Math.abs(i - hoverIndex)
    if (d === 0) return MAX
    if (d === 1) return NEAR
    if (d === 2) return NEAR2
    return BASE
  }

  const renderTile = (item: DockItem, index: number) => {
    const size = sizeFor(index)
    const Icon = item.icon
    const isHovered = hoverIndex === index
    const active = activeTab === item.id
    return (
      <button
        key={item.id}
        onClick={() => onTabChange(item.id)}
        onMouseEnter={() => setHoverIndex(index)}
        onFocus={() => setHoverIndex(index)}
        onBlur={() => setHoverIndex(null)}
        className="group relative flex shrink-0 flex-col items-center justify-end outline-none"
        style={{ height: MAX + 14 }}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
      >
        <span
          className={`pointer-events-none absolute -top-2 whitespace-nowrap rounded-md border border-border/60 bg-[rgba(11,13,19,0.9)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-foreground transition-all duration-200 ${
            isHovered ? "opacity-100 -translate-y-1" : "opacity-0 translate-y-0"
          }`}
        >
          {item.label}
        </span>

        <div
          className={`relative grid place-items-center rounded-2xl transition-[width,height,box-shadow] duration-200 ease-out ${
            active ? toneGlow[item.tone] : "shadow-none"
          }`}
          style={{
            width: size,
            height: size,
            transformOrigin: "bottom",
            background:
              "linear-gradient(160deg, oklch(0.22 0.03 265 / 0.9), oklch(0.14 0.02 265 / 0.9))",
            border: "1px solid oklch(0.3 0.03 265)",
          }}
        >
          <Icon
            className={`transition-colors duration-200 ${toneRing[item.tone]}`}
            style={{ width: size * 0.5, height: size * 0.5 }}
            strokeWidth={2}
          />
          <span
            className="pointer-events-none absolute inset-x-2 top-0.5 h-1/3 rounded-t-2xl opacity-40"
            style={{
              background: "linear-gradient(180deg, oklch(1 0 0 / 0.12), transparent)",
            }}
          />
        </div>

        <span
          className={`mt-1 h-1 w-1 rounded-full transition-all duration-200 ${
            active
              ? "bg-[color:var(--emerald-accent)] shadow-[0_0_8px_oklch(0.86_0.2_165/0.9)]"
              : "bg-transparent"
          }`}
        />
      </button>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-2 sm:px-4">
      <div
        ref={containerRef}
        onMouseLeave={() => setHoverIndex(null)}
        className="glass glass-border dock-scroll pointer-events-auto flex max-w-full items-end gap-1.5 overflow-x-auto rounded-3xl px-3 py-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] sm:gap-2"
      >
        {items.map((item, i) => renderTile(item, i))}
        {trailing.length > 0 && (
          <>
            <div className="mx-1 h-10 w-px shrink-0 self-center bg-border/70" />
            {trailing.map((item, i) => renderTile(item, items.length + i))}
          </>
        )}
      </div>
    </div>
  )
}

export type { DockItem }