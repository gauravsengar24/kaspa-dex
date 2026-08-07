import { Activity, Fuel, Layers3, Settings, Wallet } from "lucide-react"
import WalletConnect from "./WalletConnect"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { usePrices } from "../hooks/usePrices"
import { useKcc20State } from "../hooks/useKcc20State"
import { formatAddress } from "../utils/kaspa"

export default function Header({
  onNavigate,
}: {
  onNavigate: (tab: string) => void
}) {
  const wallet = useKaspaWallet()
  const { prices } = usePrices()
  const { pools, info } = useKcc20State()

  const kasPrice = info.kasUsd || prices.kas.usd || 0.02
  const tvl = pools.reduce((s, p) => s + (p.tvlUsd || 0), 0)
  const volume = pools.reduce((s, p) => s + (p.volUsd || 0), 0)

  const stats = [
    {
      icon: Layers3,
      label: "TVL",
      value: `$${tvl >= 1e6 ? (tvl / 1e6).toFixed(2) + "M" : tvl >= 1e3 ? (tvl / 1e3).toFixed(2) + "K" : tvl.toFixed(0)}`,
      tone: "emerald" as const,
    },
    {
      icon: Fuel,
      label: "Network",
      value: info.dataSource === "offline" ? "index offline" : `mainnet · ${info.dataSource}`,
      tone: "gold" as const,
    },
    {
      icon: Activity,
      label: "Vol 24h",
      value: `$${volume >= 1e6 ? (volume / 1e6).toFixed(1) + "M" : volume >= 1e3 ? (volume / 1e3).toFixed(1) + "K" : volume.toFixed(0)}${kasPrice > 0 ? ` · $${kasPrice.toFixed(4)}` : ""}`,
      tone: "violet" as const,
    },
  ]

  const toneClass: Record<"emerald" | "gold" | "violet", string> = {
    emerald: "text-[color:var(--emerald-accent)]",
    gold: "text-[color:var(--gold-accent)]",
    violet: "text-[color:var(--violet-accent)]",
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-[rgba(11,13,19,0.7)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-6 px-6">
        <button
          onClick={() => onNavigate("overview")}
          className="flex items-center gap-2 text-left"
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[color:var(--emerald-accent)] to-[color:var(--violet-accent)]">
            <span className="font-display text-sm font-bold text-[color:var(--onyx)]">Æ</span>
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold leading-none tracking-tight">
              Aetheris
            </div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              Kaspa · L1 + Kasplex L2
            </div>
          </div>
        </button>

        <div className="ml-4 hidden flex-1 items-center gap-2 md:flex">
          {stats.map((s) => (
            <div
              key={s.label}
              className="glass glass-border flex items-center gap-2.5 rounded-xl px-3 py-1.5"
            >
              <s.icon className={`h-3.5 w-3.5 ${toneClass[s.tone]}`} strokeWidth={2.25} />
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </span>
                <span className="font-mono text-xs font-semibold text-foreground">
                  {s.value}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button className="btn-secondary p-2.5" aria-label="Settings" onClick={() => onNavigate("settings")}>
            <Settings size={18} />
          </button>
          <div className="glass glass-border flex items-center gap-2.5 rounded-xl px-3 py-1.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="pulse-node absolute inline-flex h-full w-full rounded-full bg-[color:var(--emerald-accent)] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--emerald-accent)]" />
            </span>
            <Wallet className="h-3.5 w-3.5 text-[color:var(--emerald-accent)]" strokeWidth={2.25} />
            <span className="font-mono text-xs font-medium text-foreground">
              {wallet.connected && wallet.address
                ? formatAddress(wallet.address)
                : "Not connected"}
            </span>
          </div>
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
    </header>
  )
}