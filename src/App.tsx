import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Toaster } from "sonner"
import {
  ArrowLeftRight,
  BarChart3,
  Coins,
  Gamepad2,
  Landmark,
  LayoutDashboard,
  Rocket,
  Settings,
  Sprout,
  Wallet,
  ShieldCheck,
} from "lucide-react"
import Header from "./components/Header"
import Dock from "./components/Dock"
import type { DockItem } from "./components/Dock"
import Overview from "./components/Overview"
import AetherisSwap from "./components/AetherisSwap"
import BondingCurve from "./components/BondingCurve"
import LiquidityPool from "./components/LiquidityPool"
import LendingMarket from "./components/LendingMarket"
import YieldVaults from "./components/YieldVaults"
import PredictionMarket from "./components/PredictionMarket"
import Governance from "./components/Governance"
import Launchpad from "./components/Launchpad"
import SmartRouter from "./components/SmartRouter"
import AIAssistant from "./components/AIAssistant"
import Profile from "./components/Profile"
import PerpFutures from "./components/PerpFutures"
import Bridge from "./components/Bridge"
import ModuleASwap from "./components/ModuleASwap"
import ModuleAPools from "./components/ModuleAPools"
import KaspaL1Swap from "./components/KaspaL1Swap"
import WalletPage from "./components/WalletPage"
import P2PSwap from "./components/P2PSwap"
import DexSwap from "./components/DexSwap"
import TransactionHistory from "./components/TransactionHistory"
import PoolCard from "./components/PoolCard"
import Footer from "./components/Footer"
import { usePools } from "./hooks/usePools"

export type TabId =
  | "overview" | "swap" | "lend" | "vaults" | "launchpad" | "gamefi"
  | "governance" | "analytics" | "wallet" | "settings"
  | "pool" | "launch" | "l1-swap" | "p2p" | "classic" | "prediction" | "router"
  | "ai" | "profile" | "bridge" | "module-a" | "module-a-pools" | "history"

const dockItems: DockItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, tone: "emerald" },
  { id: "swap", label: "Swap & Pools", icon: ArrowLeftRight, tone: "emerald" },
  { id: "lend", label: "Money Market", icon: Coins, tone: "emerald" },
  { id: "vaults", label: "Yield Vaults", icon: Sprout, tone: "emerald" },
  { id: "launchpad", label: "Launchpad", icon: Rocket, tone: "gold" },
  { id: "gamefi", label: "GameFi", icon: Gamepad2, tone: "violet" },
  { id: "governance", label: "Governance", icon: Landmark, tone: "gold" },
  { id: "analytics", label: "Analytics", icon: BarChart3, tone: "platinum" },
]

const trailingDock: DockItem[] = [
  { id: "wallet", label: "Wallet", icon: Wallet, tone: "emerald" },
  { id: "settings", label: "Settings", icon: Settings, tone: "platinum" },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("overview")
  const { pools } = usePools()

  const renderTab = () => {
    switch (activeTab) {
      case "overview":
        return <Overview onNavigate={(t) => setActiveTab(t as TabId)} />
      case "swap":
        return <AetherisSwap />
      case "lend":
        return <LendingMarket />
      case "vaults":
        return <YieldVaults />
      case "launchpad":
        return <Launchpad />
      case "gamefi":
        return <PerpFutures />
      case "governance":
        return <Governance />
      case "analytics":
        return (
          <div className="space-y-5">
            <div className="mb-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--emerald-accent)]">
                Module C · Analytics
              </div>
              <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground">
                Analytics
              </h1>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                On-chain volume, TVL composition, and activity across every Aetheris module.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Pools" value={String(pools.length)} sub="live pairs" />
              <StatCard label="TVL" value={`$${(pools.reduce((s, p) => s + (p.tvl || 0), 0) / 1e6).toFixed(1)}M`} sub="all modules" />
              <StatCard label="Swap Tier" value="0.30%" sub="fee" />
              <StatCard label="Blockdag" value="testnet-10" sub="Kaspa L1" />
            </div>
            <ModuleAPools />
          </div>
        )
      case "wallet":
        return <WalletPage />
      case "settings":
        return (
          <div className="mb-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[color:var(--emerald-accent)]">
              terminal
            </div>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Aetheris — Uniframe DeFi & GameFi on Kaspa. Connect KasWare to trade on-chain.
            </p>
          </div>
        )
      case "p2p":
        return <P2PSwap />
      case "l1-swap":
        return <KaspaL1Swap />
      case "classic":
        return <DexSwap />
      case "pool":
        return <LiquidityPool />
      case "launch":
        return <BondingCurve />
      case "prediction":
        return <PredictionMarket />
      case "router":
        return <SmartRouter />
      case "ai":
        return <AIAssistant />
      case "profile":
        return <Profile />
      case "bridge":
        return <Bridge />
      case "module-a":
        return <ModuleASwap />
      case "module-a-pools":
        return <ModuleAPools />
      case "history":
        return (
          <div>
            <h1 className="font-display text-3xl font-bold mb-6">Transaction History</h1>
            <TransactionHistory />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-dvh relative flex flex-col overflow-x-clip pb-32">
      <Header onNavigate={(t) => setActiveTab(t as TabId)} />

      <main className="flex-1 w-full max-w-[1800px] mx-auto px-6 pt-6 pb-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            {renderTab()}
          </motion.div>
        </AnimatePresence>
      </main>

      <Footer />

      {activeTab === "swap" && (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => setActiveTab("classic")}
            className="glass glass-border rounded-lg px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-[color:var(--emerald-accent)]"
          >
            Classic engine
          </button>
          <button
            onClick={() => setActiveTab("l1-swap")}
            className="glass glass-border rounded-lg px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-[color:var(--emerald-accent)]"
          >
            Covenant HTLC
          </button>
        </div>
      )}
      <Dock
        items={dockItems}
        trailing={trailingDock}
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t as TabId)}
      />

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "oklch(0.19 0.025 265)",
            border: "1px solid oklch(0.3 0.03 265)",
            color: "oklch(0.97 0.01 250)",
            fontFamily: "var(--font-sans)",
          },
        }}
      />
    </div>
  )
}

const dockTrailing: DockItem[] = [
  { id: "wallet", label: "Wallet", icon: Wallet, tone: "emerald" },
  { id: "settings", label: "Settings", icon: Settings, tone: "platinum" },
]

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass glass-border rounded-2xl p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground">{value}</div>
      {sub && <div className="mt-1 font-mono text-[11px] text-[color:var(--emerald-accent)]">{sub}</div>}
    </div>
  )
}