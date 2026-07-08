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
    <header className="sticky top-0 z-50 glass-strong border-b border-kaspa-border/50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <a
            href="#"
            className="flex items-center gap-2 font-display font-extrabold text-xl"
            onClick={() => onTabChange("swap")}
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-kaspa-pink to-kaspa-purple flex items-center justify-center text-xs font-bold text-white">
              K
            </span>
            <span className="hidden sm:inline text-gradient">KASPA Swap</span>
          </a>

          <nav className="flex items-center gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`relative px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.id ? "text-white" : "text-kaspa-muted hover:text-white"
                }`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-white/5 rounded-lg"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
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
    </header>
  )
}
