import { useRef, useState } from "react"
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "framer-motion"

interface DockProps {
  tabs: { id: string; label: string; icon: any }[]
  activeTab: string
  onTabChange: (tab: string) => void
}

export default function Dock({ tabs, activeTab, onTabChange }: DockProps) {
  const mouseX = useMotionValue(Infinity)
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-2 pb-2">
      <motion.div
        onMouseMove={(e) => mouseX.set(e.pageX)}
        onMouseLeave={() => { mouseX.set(Infinity); setHovered(null) }}
        className="dock-shell flex items-end gap-1.5 rounded-[26px] px-2.5 py-2.5"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.15 }}
      >
        {tabs.map((tab) => (
          <DockItem
            key={tab.id}
            tab={tab}
            active={activeTab === tab.id}
            mouseX={mouseX}
            onHover={(v) => setHovered(v)}
            onClick={() => onTabChange(tab.id)}
          />
        ))}
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className="absolute -top-9 left-1/2 -translate-x-1/2 pointer-events-none text-[11px] font-medium text-white whitespace-nowrap px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(16,19,36,0.72)",
                backdropFilter: "blur(16px) saturate(180%)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)",
              }}
            >
              {hovered}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function DockItem({
  tab,
  active,
  mouseX,
  onHover,
  onClick,
}: {
  tab: { id: string; label: string; icon: any }
  active: boolean
  mouseX: any
  onHover: (label: string | null) => void
  onClick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const IconComp = tab.icon

  const distance = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
    return val - bounds.x - bounds.width / 2
  })

  const widthSync = useTransform(distance, [-150, 0, 150], [46, 62, 46])
  const width = useSpring(widthSync, { mass: 0.1, stiffness: 200, damping: 14 })
  const heightSync = useTransform(distance, [-150, 0, 150], [46, 62, 46])
  const height = useSpring(heightSync, { mass: 0.1, stiffness: 200, damping: 14 })

  return (
    <button
      ref={ref}
      onMouseEnter={() => onHover(tab.label)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
      style={{ width: width as any, height: height as any }}
      className="relative flex items-center justify-center rounded-[16px] dock-icon"
    >
      <IconComp
        size={22}
        className={active ? "text-kaspa-cyan drop-shadow-[0_0_8px_rgba(92,214,255,0.6)]" : "text-white/75"}
      />
      {active && (
        <motion.span
          layoutId="dock-active-dot"
          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-kaspa-cyan"
          style={{ boxShadow: "0 0 8px rgba(92,214,255,0.8)" }}
        />
      )}
    </button>
  )
}