import { motion } from "framer-motion"
import { Settings } from "lucide-react"
import WalletConnect from "./WalletConnect"
import PriceTicker from "./PriceTicker"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { usePrices } from "../hooks/usePrices"

interface HeaderProps {
  activeTab: string
  onTabChange: (tab: any) => void
  tabs: { id: string; label: string }[]
}

export default function Header({ activeTab, onTabChange, tabs }: HeaderProps) {
  const wallet = useKaspaWallet()
  const { prices, loading, refresh } = usePrices()

  return (
    <header className="sticky top-0 z-40">
      <div className="glass-strong border-x-0 border-t-0" style={{ borderLeft: "none", borderRight: "none", borderRadius: "0 0 24px 24px" }}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-6">
          {/* iMac traffic lights */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <span className="w-3 h-3 rounded-full bg-[#ff5f57] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" />
            <span className="w-3 h-3 rounded-full bg-[#febc2e] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" />
            <span className="w-3 h-3 rounded-full bg-[#28c840] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" />
          </div>

          <a
            href="#"
            className="flex items-center gap-2 font-display font-extrabold text-lg shrink-0"
            onClick={() => onTabChange("swap")}
          >
            <span className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-kaspa-blue to-kaspa-purple flex items-center justify-center text-xs font-bold text-white glow-cyan">
              K
            </span>
            <span className="hidden md:inline text-gradient tracking-tight">Kaspa Swap</span>
          </a>

          <nav className="hidden lg:flex items-center gap-0.5 ml-auto">
            {tabs.slice(0, 8).map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`relative px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors ${
                  activeTab === tab.id ? "text-white" : "text-kaspa-muted hover:text-white"
                }`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 ml-auto lg:ml-2">
            <button className="btn-secondary p-2.5" aria-label="Settings">
              <Settings size={18} />
            </button>
            <WalletConnect
              connected={wallet.connected}
              address={wallet.address}
              balance={wallet.balanceFormatted}
              connecting={wallet.connecting}
              detecting={wallet.detecting}
              kaswareDetected={wallet.kaswareDetected}
              error={wallet.error}
              onConnect={wallet.connect}
              onDisconnect={wallet.disconnect}
            />
          </div>
        </div>

        <PriceTicker prices={prices} loading={loading} onRefresh={refresh} />
      </div>
    </header>
  )
}