import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
  ArrowLeftRight,
  Droplets,
  Rocket,
  Landmark,
  Vote,
  Swords,
  ArrowRightLeft,
  ArrowRight,
  Route,
  Bot,
  Zap,
  Globe,
  Activity,
  TrendingUp,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import PriceChart from "./PriceChart"
import { usePrices } from "../hooks/usePrices"
import { usePools } from "../hooks/usePools"
import { NETWORK } from "../utils/constants"
import { formatUsd } from "../utils/kaspa"

interface OverviewProps {
  onNavigate: (tab: string) => void
}

interface NetworkInfo {
  dexAddress: string
  kasUsdtRate: number
  network: string
  explorer: string
  covenants: boolean
  htlcEnabled: boolean
  chainDaa: number | null
  timeoutDaa: number
}

interface OrderInfo {
  id: string
  maker_address: string
  amount_kas: number
  token_out: string
  status: string
  txid_fund?: string
  txid_claim?: string
}

const MODULES = [
  {
    id: "swap",
    title: "Swap",
    desc: "Instant token swaps with smart routing across all liquidity",
    icon: ArrowLeftRight,
    gradient: "from-[#5cd6ff] to-[#8ea5ff]",
  },
  {
    id: "l1-swap",
    title: "P2P Covenants",
    desc: "On-chain HTLC atomic swaps with USDT settlement",
    icon: ShieldCheck,
    gradient: "from-[#8ea5ff] to-[#c084fc]",
  },
  {
    id: "pool",
    title: "Liquidity",
    desc: "Provide liquidity and earn trading fees on Kaspa",
    icon: Droplets,
    gradient: "from-[#30e0c8] to-[#5cd6ff]",
  },
  {
    id: "launchpad",
    title: "Launchpad",
    desc: "Bonding curves and fair launches for new KRC-20 tokens",
    icon: Rocket,
    gradient: "from-[#f8c86a] to-[#ff9e5e]",
  },
  {
    id: "lending",
    title: "Money Market",
    desc: "Lend and borrow KRC-20 assets with variable rates",
    icon: Landmark,
    gradient: "from-[#ff6b7a] to-[#ff9e5e]",
  },
  {
    id: "governance",
    title: "Governance",
    desc: "Proposals and votes to steer the Aetheris protocol",
    icon: Vote,
    gradient: "from-[#c084fc] to-[#f472b6]",
  },
  {
    id: "perps",
    title: "GameFi · Perps",
    desc: "Leveraged trading and on-chain games, unified",
    icon: Swords,
    gradient: "from-[#a855f7] to-[#5cd6ff]",
  },
  {
    id: "bridge",
    title: "Native Bridge",
    desc: "Bridge KAS and KRC-20 assets across networks",
    icon: Globe,
    gradient: "from-[#3ddc97] to-[#30e0c8]",
  },
]

const secondary = [
  { id: "prediction", title: "Prediction Markets", icon: TrendingUp },
  { id: "router", title: "Smart Router", icon: Route },
  { id: "ai", title: "AI Assistant", icon: Bot },
  { id: "yield", title: "Yield Vaults", icon: Zap },
]

export default function Overview({ onNavigate }: OverviewProps) {
  const { prices } = usePrices()
  const { pools } = usePools()
  const [network, setNetwork] = useState<NetworkInfo | null>(null)
  const [orders, setOrders] = useState<OrderInfo[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [netRes, orderRes] = await Promise.all([
          fetch(`${NETWORK.backend}/api/network`),
          fetch(`${NETWORK.backend}/api/covenant/orders`),
        ])
        if (!cancelled) {
          if (netRes.ok) setNetwork(await netRes.json())
          if (orderRes.ok) {
            const data = await orderRes.json()
            setOrders(Array.isArray(data.orders) ? data.orders : [])
          }
        }
      } catch {
        /* backend offline — render without live data */
      }
    }
    load()
    const t = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  const kasPrice = prices.kas.usd || 0.02
  const tvl = pools.reduce((sum, p) => sum + (p.tvl || 0), 0) + orders.length * 0.5
  const volume24h = pools.reduce((sum, p) => sum + (p.volume24h || 0), 0) * kasPrice
  const activeOrders = orders.filter((o) => o.status === "OPEN").length
  const rate = network?.kasUsdtRate ?? 0.15

  return (
    <div className="space-y-10">
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden rounded-3xl glass p-8 md:p-12">
        <div
          className="pointer-events-none absolute -top-32 -right-24 w-[420px] h-[420px] rounded-full opacity-40 blur-[100px]"
          style={{ background: "radial-gradient(circle, rgba(138,165,255,0.55), transparent 60%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-24 w-[400px] h-[400px] rounded-full opacity-30 blur-[110px]"
          style={{ background: "radial-gradient(circle, rgba(168,85,247,0.5), transparent 60%)" }}
        />

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative"
        >
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-kaspa-cyan flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-kaspa-cyan/10 border border-kaspa-cyan/25">
              <Sparkles size={11} /> Kaspa Protocol
            </span>
            <span className="text-[11px] font-mono text-kaspa-muted px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              {network?.network ?? "testnet-10"}
            </span>
            {network?.chainDaa && (
              <span className="text-[11px] font-mono text-kaspa-teal px-3 py-1.5 rounded-full bg-kaspa-teal/10 border border-kaspa-teal/25">
                DAA {network.chainDaa.toLocaleString()}
              </span>
            )}
          </div>

          <h1 className="font-display font-extrabold tracking-tight leading-none">
            <span className="block text-4xl md:text-6xl text-aether">AETHERIS</span>
            <span className="block text-lg md:text-2xl text-white/85 mt-3 font-semibold">
              A Unified DeFi & GameFi Mega-Protocol on Kaspa
            </span>
          </h1>

          <p className="mt-4 max-w-xl text-kaspa-muted text-sm md:text-base leading-relaxed">
            Swap, provide liquidity, launch tokens, lend, govern and play — all on one
            covenant-powered terminal. Every trade on Kaspa L1 settles atomically via HTLC.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-8">
            <button className="btn-primary px-7 py-3.5" onClick={() => onNavigate("swap")}>
              <span className="flex items-center gap-2">
                Enter the Terminal <ArrowRight size={16} />
              </span>
            </button>
            <button className="btn-secondary px-7 py-3.5" onClick={() => onNavigate("l1-swap")}>
              <span className="flex items-center gap-2">
                <ShieldCheck size={16} /> P2P Covenant Swap
              </span>
            </button>
          </div>
        </motion.div>
      </section>

      {/* ---------- Live stats ---------- */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="KAS Price" value={formatUsd(kasPrice)} sub={`${(kasPrice * rate).toFixed(3)} USDT`} accent="#5cd6ff" />
        <StatCard label="Protocol TVL" value={formatUsd(tvl)} sub={`${pools.length} liquidity pools`} accent="#8ea5ff" />
        <StatCard label="24h Volume" value={formatUsd(volume24h)} sub="across all modules" accent="#c084fc" />
        <StatCard label="Open HTLC Orders" value={String(activeOrders)} sub={rate ? `1 KAS ≈ ${rate} USDT` : "covenants live"} accent="#30e0c8" />
      </section>

      {/* ---------- Market + activity ---------- */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <PriceChart symbol="KAS/USD" currentPrice={kasPrice} change24h={prices.kas.change24h} />
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-display font-semibold text-white flex items-center gap-2">
              <Activity size={14} className="text-kaspa-cyan" /> Covenant Activity
            </h3>
            <span className="text-[10px] font-mono text-kaspa-muted uppercase tracking-wider">live</span>
          </div>
          <div className="space-y-2.5 max-h-40 overflow-y-auto pr-1">
            {orders.length === 0 && (
              <p className="text-xs text-kaspa-muted py-6 text-center">
                No orders yet. Open a P2P covenant swap to see on-chain activity.
              </p>
            )}
            {orders.slice(0, 6).map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 text-xs bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.status === "OPEN" ? "bg-kaspa-cyan" : o.status === "CLAIMED" ? "bg-kaspa-green" : o.status === "REFUNDED" ? "bg-kaspa-red" : "bg-kaspa-gold"}`} />
                  <span className="font-mono text-kaspa-muted truncate">{o.id.slice(0, 8)}</span>
                </div>
                <span className="text-kaspa-muted">{o.amount_kas} KAS → {o.token_out}</span>
                <span className={`font-semibold ${o.status === "CLAIMED" ? "text-kaspa-green" : "text-kaspa-cyan"}`}>{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Modules ---------- */}
      <section>
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-xl md:text-2xl font-display font-bold">Protocol Modules</h2>
            <p className="text-kaspa-muted text-sm mt-1">Every product under the Aetheris umbrella</p>
          </div>
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-kaspa-cyan font-medium">
            <ShieldCheck size={13} /> covenants secured
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MODULES.map((m, i) => (
            <motion.button
              key={m.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.4 }}
              onClick={() => onNavigate(m.id)}
              className="group text-left glass rounded-2xl p-5 hover:-translate-y-1"
            >
              <span className={`inline-flex w-11 h-11 items-center justify-center rounded-xl bg-gradient-to-br ${m.gradient} text-white shadow-lg mb-4`}>
                <m.icon size={20} />
              </span>
              <h3 className="font-display font-bold text-[15px] text-white group-hover:text-kaspa-cyan transition-colors">
                {m.title}
              </h3>
              <p className="text-xs text-kaspa-muted mt-1.5 leading-relaxed">{m.desc}</p>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-kaspa-cyan mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                Enter <ArrowRight size={11} />
              </span>
            </motion.button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {secondary.map((s) => (
            <button
              key={s.id}
              onClick={() => onNavigate(s.id)}
              className="flex items-center gap-2 text-xs font-medium text-kaspa-muted hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-full px-4 py-2 transition-colors"
            >
              <s.icon size={13} /> {s.title}
            </button>
          ))}
        </div>
      </section>

      {/* ---------- About strip ---------- */}
      <section className="glass rounded-3xl p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-kaspa-muted mb-2">Settlement</h4>
            <p className="text-sm text-white/85 leading-relaxed">
              Trades settle on-chain via HTLC covenants (KIP-17). Funds lock to a script, never a
              counterparty — claim or refund is deterministic.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-kaspa-muted mb-2">Tokens</h4>
            <p className="text-sm text-white/85 leading-relaxed">
              Native KRC-20 credits are issued atomically on claim. The DEX treasury funds
              counterparty liquidity — {rate} USDT per KAS.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-kaspa-muted mb-2">Network</h4>
            <p className="text-sm text-white/85 leading-relaxed break-all font-mono text-kaspa-cyan/80">
              {network?.dexAddress ?? "DEX treasury: kaspatest:…"}
            </p>
            {network?.explorer && (
              <a href={network.explorer} target="_blank" rel="noreferrer" className="text-xs text-kaspa-cyan underline-offset-4 hover:underline mt-1 inline-block">
                Open explorer →
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Quick actions ---------- */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { tab: "wallet", label: "Open Wallet", sub: "connect KasWare to get started", icon: ArrowLeftRight },
          { tab: "history", label: "Transaction History", sub: "all modules", icon: Activity },
          { tab: "profile", label: "Your Profile", sub: "orders & credits", icon: Vote },
          { tab: "pools", label: "Liquidity Pools", sub: `${pools.length} live pairs`, icon: Droplets },
        ].map((a) => (
          <button key={a.tab} onClick={() => onNavigate(a.tab)} className="group glass rounded-2xl px-4 py-4 text-left hover:-translate-y-0.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <a.icon size={14} className="text-kaspa-purple" />
              {a.label}
            </div>
            <p className="text-[11px] text-kaspa-muted mt-1">{a.sub}</p>
          </button>
        ))}
      </section>
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden">
      <div
        className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-25 blur-[60px]"
        style={{ background: accent }}
      />
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-kaspa-muted">{label}</p>
      <p className="font-display font-extrabold text-2xl mt-2 text-white font-mono">{value}</p>
      <p className="text-[11px] text-kaspa-muted mt-1">{sub}</p>
    </div>
  )
}
