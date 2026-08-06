import { useEffect, useState } from "react"
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Coins,
  Gamepad2,
  Landmark,
  Layers3,
  Rocket,
  Sprout,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { PageHeader } from "./aetheris/PageHeader"
import { StatTile } from "./aetheris/StatTile"
import { GlassCard, SectionLabel } from "./aetheris/GlassCard"
import { Sparkline } from "./aetheris/Sparkline"
import { usePrices } from "../hooks/usePrices"
import { usePools } from "../hooks/usePools"
import { useKcc20State } from "../hooks/useKcc20State"
import { NETWORK } from "../utils/constants"

interface NetworkInfo {
  network: string
  dexAddress: string
  kasUsdtRate: number
  chainDaa: number | null
}

interface OrderInfo {
  id: string
  amount_kas: number
  token_out: string
  status: string
}

interface OverviewProps {
  onNavigate: (tab: string) => void
}

const quickLinks = [
  { tab: "swap", icon: ArrowLeftRight, label: "Swap", tone: "emerald" as const },
  { tab: "lend", icon: Coins, label: "Lend & Borrow", tone: "emerald" as const },
  { tab: "vaults", icon: Sprout, label: "Yield Vaults", tone: "emerald" as const },
  { tab: "launchpad", icon: Rocket, label: "Launchpad", tone: "gold" as const },
  { tab: "gamefi", icon: Gamepad2, label: "GameFi", tone: "violet" as const },
  { tab: "governance", icon: Landmark, label: "Governance", tone: "gold" as const },
]

const toneClass = {
  emerald: "text-[color:var(--emerald-accent)]",
  gold: "text-[color:var(--gold-accent)]",
  violet: "text-[color:var(--violet-accent)]",
  crimson: "text-[color:var(--crimson)]",
}

const sparkData = [22, 24, 23, 26, 28, 27, 30, 34, 32, 38, 42, 40, 44, 47, 45, 48]

const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })

export default function Overview({ onNavigate }: OverviewProps) {
  const { prices } = usePrices()
  const { pools } = usePools()
  const { trades: l1Trades, pools: l1Pools, info: l1Info } = useKcc20State()
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
        /* offline */
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
  const tvl = pools.reduce((s, p) => s + (p.tvl || 0), 0)
  const volume24h = pools.reduce((s, p) => s + (p.volume24h || 0), 0) * kasPrice
  const openOrders = orders.filter((o) => o.status === "OPEN").length
  const rate = network?.kasUsdtRate ?? 0.15

  const baseActivity: {
    id: number
    type: string
    detail: string
    when: string
    tone: string
    txid?: string
  }[] = [
    { id: 1, type: "Swap", detail: `1,240 KAS → ${(1240 * rate).toFixed(2)} USDT`, when: "2m", tone: "emerald" },
    { id: 2, type: "Network", detail: network?.network ?? "testnet-10", when: network?.chainDaa ? `DAA ${network.chainDaa.toLocaleString()}` : "live", tone: "gold" },
    { id: 3, type: "Rate", detail: `1 KAS ≈ ${rate.toFixed(2)} USDT`, when: "oracle", tone: "violet" },
    { id: 4, type: "Liquidity", detail: `${l1Pools.length || pools.length} live pools · $${fmt(tvl, 0)} TVL`, when: "30s", tone: "emerald" },
    { id: 5, type: "Covenants", detail: `${openOrders} open HTLC orders`, when: "on-chain", tone: "violet" },
    { id: 6, type: "L1 Trades", detail: `${l1Trades.length} KCC-20 trades decoded`, when: l1Info.synced ? `DAA ${l1Info.daaScore?.toLocaleString() ?? "—"}` : "syncing", tone: "gold" },
  ]

  const feed = l1Trades.slice(0, 4).map((t) => ({
    id: 100 + t.id,
    type: t.kind,
    detail: t.amount,
    when: t.when,
    tone: t.kind === "Buy" ? ("emerald" as const) : ("crimson" as const),
    txid: t.txid,
  }))

  const activity = [...baseActivity, ...feed]

  return (
    <>
      <PageHeader
        eyebrow="Command Center"
        title="Aetheris Overview"
        subtitle="Every module of the protocol, one deck. Trade, lend, farm, launch, play, and vote — all Kaspa-native."
        right={
          <button
            onClick={() => onNavigate("wallet")}
            className="glass glass-border rounded-xl px-3 py-2 font-mono text-xs text-foreground transition-transform hover:-translate-y-0.5"
          >
            View wallet
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={Wallet} label="Portfolio" value={`$${fmt(tvl, 0)}`} delta="TVL across pools" tone="emerald" />
        <StatTile icon={Layers3} label="Supplied" value={`$${fmt(tvl / 2, 0)}`} delta="Yield 6.8%" tone="emerald" />
        <StatTile icon={ArrowUpRight} label="Borrowed" value="$3,120" delta="HF 1.87×" tone="gold" />
        <StatTile icon={TrendingUp} label="Open Orders" value={String(openOrders)} delta={`${rate.toFixed(2)} USDT / KAS`} tone="violet" />
      </div>

      <div className="mt-5 grid grid-cols-12 gap-5">
        <GlassCard className="col-span-12 lg:col-span-8">
          <SectionLabel
            eyebrow="Market · 30D"
            title="KAS price across the day"
            right={
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--emerald-accent)]">
                {kasPrice > 0 ? `$${kasPrice.toFixed(4)}` : "live"}
              </span>
            }
          />
          <div className="rounded-xl border border-border/40 bg-[oklch(0.11_0.02_265)]/60 p-4">
            <Sparkline
              data={sparkData}
              color="oklch(0.86 0.2 165)"
              width={720}
              height={160}
            />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3 font-mono text-[11px]">
            {[
              ["Swap Vol", `$${fmt(volume24h, 0)}`, "emerald"],
              ["Vault APY", "142.6%", "gold"],
              ["Predictions Won", "24 / 41", "violet"],
              ["Vote Power", "18,204 veAETH", "gold"],
            ].map(([l, v, t]) => (
              <div key={l} className="rounded-lg border border-border/50 px-3 py-2">
                <div className="text-muted-foreground">{l}</div>
                <div className={`mt-0.5 font-display text-sm font-semibold ${toneClass[t as keyof typeof toneClass]}`}>
                  {v}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-4">
          <SectionLabel eyebrow="Live" title="Recent activity" right={<Activity className="h-4 w-4 text-[color:var(--emerald-accent)]" />} />
          <div className="space-y-2">
            {[...activity, ...feed].map((a) => (
              <div
                key={a.id}
                title={a.txid ? `TX ${a.txid}` : undefined}
                className="flex items-center justify-between rounded-lg border border-border/40 bg-[oklch(0.16_0.025_265)]/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className={`font-mono text-[10px] uppercase tracking-wider ${toneClass[a.tone as keyof typeof toneClass]}`}>
                    {a.type}
                  </div>
                  <div className="truncate font-mono text-xs text-foreground">{a.detail}</div>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">{a.when}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="col-span-12">
          <SectionLabel eyebrow="Jump to module" title="Protocol shortcuts" right={<BarChart3 className="h-4 w-4 text-[color:var(--platinum)]" />} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {quickLinks.map((q) => (
              <button
                key={q.tab}
                onClick={() => onNavigate(q.tab)}
                className="group flex flex-col items-start gap-3 rounded-xl border border-border/50 bg-[oklch(0.16_0.025_265)]/60 p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-[color:var(--emerald-accent)]/40"
              >
                <q.icon className={`h-5 w-5 ${toneClass[q.tone]}`} strokeWidth={2.25} />
                <div>
                  <div className="font-display text-sm font-semibold text-foreground">{q.label}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground group-hover:text-foreground">
                    Open module →
                  </div>
                </div>
              </button>
            ))}
          </div>
        </GlassCard>
      </div>
    </>
  )
}