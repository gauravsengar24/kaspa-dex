import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeftRight, LayoutDashboard, History, Landmark, PiggyBank, TrendingUp, Vote, Rocket, Route, Bot, User, Zap, SendToBack, Layers, PieChart, ArrowRightLeft, Wallet } from "lucide-react"
import Header from "./components/Header"
import P2PSwap from "./components/P2PSwap"
import Orderbook from "./components/Orderbook"
import PoolCard from "./components/PoolCard"
import TransactionHistory from "./components/TransactionHistory"
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

import WalletPage from "./components/WalletPage"
import Footer from "./components/Footer"
import { KASPA_TOKEN } from "./utils/constants"
import { usePools } from "./hooks/usePools"

export type TabId = "swap" | "pools" | "history" | "lending" | "yield" | "prediction" | "governance" | "launchpad" | "router" | "ai" | "profile" | "perps" | "bridge" | "module-a" | "module-a-pools" | "l1-swap" | "wallet"

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("swap")
  const { pools } = usePools()

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: "swap", label: "Swap", icon: ArrowLeftRight },
    { id: "l1-swap", label: "L1 DEX", icon: ArrowRightLeft },
    { id: "wallet", label: "Wallet", icon: Wallet },
    { id: "module-a", label: "Mod A", icon: Layers },
    { id: "perps", label: "Perps", icon: Zap },
    { id: "pools", label: "Pools", icon: LayoutDashboard },
    { id: "module-a-pools", label: "Weighted", icon: PieChart },
    { id: "bridge", label: "Bridge", icon: SendToBack },
    { id: "lending", label: "Lending", icon: Landmark },
    { id: "yield", label: "Yield", icon: PiggyBank },
    { id: "prediction", label: "Predict", icon: TrendingUp },
    { id: "governance", label: "Govern", icon: Vote },
    { id: "launchpad", label: "Launchpad", icon: Rocket },
    { id: "router", label: "Router", icon: Route },
    { id: "ai", label: "AI", icon: Bot },
    { id: "profile", label: "Profile", icon: User },
    { id: "history", label: "History", icon: History },
  ]

  const renderTab = () => {
    switch (activeTab) {
      case "swap":
        return <P2PSwap />
      case "l1-swap":
        return <P2PSwap />
      case "wallet":
        return <WalletPage />
      case "perps":
        return <PerpFutures />
      case "pools":
        return (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-display font-bold">Liquidity Pools</h1>
                <p className="text-kaspa-muted text-sm mt-1">Provide liquidity and earn fees</p>
              </div>
              <button className="btn-primary px-6">+ New Position</button>
            </div>
            {pools.length === 0 && (
              <div className="col-span-full text-center text-kaspa-muted text-sm py-12">
                No liquidity pools deployed yet. Create a pair to get started.
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pools.length === 0 && (
                <div className="col-span-full text-center text-kaspa-muted text-sm py-12">
                  No liquidity pools deployed yet. Create a pair to get started.
                </div>
              )}
              {pools.map((pool) => (
                <PoolCard key={pool.id} pool={pool} />
              ))}
            </div>
          </div>
        )
      case "bridge":
        return <Bridge />
      case "module-a":
        return <ModuleASwap />
      case "module-a-pools":
        return <ModuleAPools />
      case "history":
        return (
          <div>
            <h1 className="text-2xl font-display font-bold mb-6">Transaction History</h1>
            <TransactionHistory />
          </div>
        )
      case "lending":
        return <LendingMarket />
      case "yield":
        return <YieldVaults />
      case "prediction":
        return <PredictionMarket />
      case "governance":
        return <Governance />
      case "launchpad":
        return <Launchpad />
      case "router":
        return <SmartRouter />
      case "ai":
        return <AIAssistant />
      case "profile":
        return <Profile />
      default:
        return null
    }
  }

  return (
    <div className="min-h-dvh bg-kaspa-dark flex flex-col">
      <Header activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs.map(({ id, label }) => ({ id, label }))} />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 pb-32 pt-6">
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
    </div>
  )
}
