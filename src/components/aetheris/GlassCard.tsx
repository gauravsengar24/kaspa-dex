import { forwardRef, type HTMLAttributes, type ReactNode } from "react"
import { cn } from "../../lib/utils"

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  hover?: boolean
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, children, hover = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "glass glass-border rounded-2xl p-6 transition-all duration-300",
        hover && "hover:-translate-y-0.5 hover:shadow-[0_20px_50px_-20px_oklch(0.86_0.2_165_/_0.25)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
)
GlassCard.displayName = "GlassCard"

export function SectionLabel({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string
  title: string
  right?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {eyebrow}
        </div>
        <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </div>
      {right}
    </div>
  )
}