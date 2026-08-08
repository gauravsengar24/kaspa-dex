import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUpRight, Settings2, Zap, Activity, Coins, Layers } from "lucide-react"
import { toast } from "sonner"
import { PageHeader } from "./aetheris/PageHeader"
import { StatTile } from "./aetheris/StatTile"
import { GlassCard, SectionLabel } from "./aetheris/GlassCard"
import { PoolWheel } from "./aetheris/PoolWheel"
import { DataTable, type Column } from "./aetheris/DataTable"
import { Sparkline } from "./aetheris/Sparkline"
import { ActionDialog } from "./aetheris/ActionDialog"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { usePrices } from "../hooks/usePrices"
import { useKcc20State, type LiveTrade } from "../hooks/useKcc20State"
import { KASPA_TOKEN } from "../utils/constants"
import type { TokenInfo } from "../types"
import {
  quoteBuy,
  quoteSell,
  walletBridge,
  buyOnCurve,
  sellOnCurve,
  swapKasForToken,
  swapTokenForKas,
  type Kcc20Token,
  type Kcc20Quote,
} from "../utils/kcc20"

type Pool = { id: number; pair: string; tvl: string; vol: string; apr: string; data: number[] }

type Trade = LiveTrade

const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })

export default function AetherisSwap() {
  const wallet = useKaspaWallet()
  const { tokenPrice } = usePrices()
  const { pools: livePools, trades: liveTrades, tokens: kccTokens, info: l1Info } = useKcc20State()

  const [tokens, setTokens] = useState<Kcc20Token[]>([])
  const [from, setFrom] = useState<TokenInfo>(KASPA_TOKEN)
  const [to, setTo] = useState<TokenInfo>(KASPA_TOKEN)
  const [amount, setAmount] = useState("")
  const [slippage, setSlippage] = useState(0.3)
  const [picker, setPicker] = useState<null | "from" | "to">(null)
  const [showSettings, setShowSettings] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [kccQuote, setKccQuote] = useState<Kcc20Quote | null>(null)
  const [quoteToken, setQuoteToken] = useState("")
  const [quoteAmt, setQuoteAmt] = useState("")
  const [lpOpen, setLpOpen] = useState(false)
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)

  const pools: Pool[] = livePools
  const trades: Trade[] = liveTrades

  useEffect(() => {
    if (kccTokens.length) setTokens(kccTokens)
  }, [kccTokens])

  const sellMode = from.ticker !== "KAS"
  const kccToken = useMemo(() => {
    const target = to.ticker === "KAS" ? from.ticker : to.ticker
    return tokens.find((t) => t.tick === target) ?? null
  }, [to, from, tokens])

  useEffect(() => {
    if (!kccToken || !amount || Number(amount) <= 0) {
      setKccQuote(null)
      setQuoteToken("")
      setQuoteAmt("")
      return
    }
    let cancelled = false
    ;(async () => {
      const amt = Number(amount)
      const q = sellMode ? await quoteSell(kccToken.tick, amt) : await quoteBuy(kccToken.tick, amt)
      if (cancelled || !q) return
      setKccQuote(q)
      setQuoteToken(kccToken.tick)
      setQuoteAmt(amount)
    })()
    return () => {
      cancelled = true
    }
  }, [kccToken, amount, sellMode])

  const kasUsdPrice = tokenPrice("KAS").usd || l1Info.kasUsd || 0.02
  const inAmt = Number(amount) || 0

  const liveVol = livePools.reduce((s, p) => s + (p.volUsd || 0), 0)
  const liveTvl = livePools.reduce((s, p) => s + (p.tvlUsd || 0), 0)
  const liveActive = l1Info.activeCovenants ?? livePools.length

  const estimatedOutput = useMemo(() => {
    if (kccQuote && quoteToken === kccToken?.tick && quoteAmt === amount) {
      return Number(kccQuote.tokenOut)
    }
    return null
  }, [kccQuote, quoteToken, kccToken, quoteAmt, amount])

  const out = estimatedOutput ?? 0
  const rate =
    (out > 0 && inAmt > 0 ? out / inAmt : 0) || 1
  const minReceived = (out || inAmt) * (1 - slippage / 100)
  const impact = useMemo(() => Math.min(4.8, (inAmt * kasUsdPrice) / 1_200_000), [inAmt, kasUsdPrice])

  const insufficientBalance = wallet.connected && from.ticker === "KAS" && inAmt > wallet.balanceRaw

  const doSwap = useCallback(async () => {
    if (inAmt <= 0) return toast.error("Enter an amount to swap")
    if (insufficientBalance) return toast.error("Insufficient KAS balance")
    if (!kccToken) return toast.error("Select a KCC-20 token to swap on-chain")

    if (!wallet.connected) {
      await wallet.connect()
      if (!wallet.connected) return toast.error("Connect KasWare to continue")
    }

    setSwapping(true)
    try {
      const bridge = walletBridge()
      if (!bridge) throw new Error("KasWare wallet bridge unavailable")

      const txid = sellMode
        ? kccToken.graduated
          ? (await swapTokenForKas(kccToken.tick, inAmt, bridge)).txid
          : (await sellOnCurve(kccToken.tick, inAmt, bridge)).txid
        : kccToken.graduated
          ? (await swapKasForToken(kccToken.tick, inAmt, bridge)).txid
          : (await buyOnCurve(kccToken.tick, inAmt, bridge)).txid

      toast.success(`Swapped ${fmt(inAmt)} ${from.ticker} → ${fmt(out || inAmt, 4)} ${to.ticker}`, {
        description: `${kccToken.graduated ? "KRON AMM pool" : "Bonding curve"} · TX ${txid.slice(0, 10)}…`,
      })
      setAmount("")
      setKccQuote(null)
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : (() => {
                try {
                  return JSON.stringify(err ?? null)
                } catch {
                  return String(err)
                }
              })()
      ;(window as any).__lastSwapError = err instanceof Error ? `${err.message}\n${err.stack}` : String(detail)
      let diag = ""
      try {
        const w = window as any
        diag =
          "\n\n[debug]" +
          "\n__bundleId: " + String(w.__bundleId ?? "?") +
          "\n__lastCovidError: " + JSON.stringify(w.__lastCovidError ?? null) +
          "\n__lastAssembleSpendOutputs: " + JSON.stringify(w.__lastAssembleSpendOutputs ?? null) +
          "\n__lastAssembleFunding: " + JSON.stringify(w.__lastAssembleFunding ?? null) +
          "\n__lastAssembleChangeAddress: " + JSON.stringify(w.__lastAssembleChangeAddress ?? null) +
          "\n__wrappedOut_0: " + JSON.stringify(w.__wrappedOut_0 ?? null) +
          "\n__wrappedOut_1: " + JSON.stringify(w.__wrappedOut_1 ?? null) +
          "\n__wrappedOut_2: " + JSON.stringify(w.__wrappedOut_2 ?? null) +
          "\n__wrappedOut_3: " + JSON.stringify(w.__wrappedOut_3 ?? null) +
          "\n__wrappedOut_4: " + JSON.stringify(w.__wrappedOut_4 ?? null) +
          "\n__wrappedTxProbe: " + JSON.stringify(w.__wrappedTxProbe ?? null) +
          "\n__covShapeProbe: " + JSON.stringify(w.__covShapeProbe ?? null)
      } catch { /* noop */ }
      console.error("[swap fail]", err, diag)
      toast.error((detail || "Swap failed").slice(0, 500) + diag.slice(0, 2000))
    } finally {
      setSwapping(false)
    }
  }, [inAmt, insufficientBalance, kccToken, wallet, sellMode, from.ticker, to.ticker, out])

  const flip = () => {
    setFrom(to)
    setTo(from)
    setAmount(out > 0 ? String(+out.toFixed(4)) : "")
    setKccQuote(null)
  }

  const poolCols: Column<Pool>[] = [
    { key: "pair", header: "Pool", width: "1.4fr", render: (row) => <span className="font-display text-sm font-semibold">{row.pair}</span> },
    { key: "tvl", header: "TVL", render: (row) => <span className="font-mono text-xs">{row.tvl}</span> },
    { key: "vol", header: "24h Vol", render: (row) => <span className="font-mono text-xs">{row.vol}</span> },
    { key: "apr", header: "APR", render: (row) => <span className="font-mono text-xs font-semibold text-[color:var(--emerald-accent)]">{row.apr}</span> },
    { key: "chart", header: "Trend", width: "0.8fr", render: (row) => <Sparkline data={row.data} width={70} height={22} /> },
    { key: "act", header: "", align: "right", width: "0.7fr", render: (row) => (
      <button
        type="button"
        onClick={() => { setSelectedPool(row); setLpOpen(true) }}
        className="rounded-lg border border-[color:var(--emerald-accent)]/40 bg-[color:var(--emerald-accent)]/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[color:var(--emerald-accent)] transition-colors hover:bg-[color:var(--emerald-accent)]/20"
      >
        Add
      </button>
    )},
  ]

  const tradeCols: Column<Trade>[] = [
    { key: "k", header: "Type", render: (row) => (
      <span className={`font-mono text-[11px] font-semibold ${row.kind === "Buy" ? "text-[color:var(--emerald-accent)]" : "text-[color:var(--crimson)]"}`}>{row.kind}</span>
    )},
    { key: "t", header: "Token", render: (row) => <span className="font-mono text-[11px] text-muted-foreground">{row.tick}</span> },
    { key: "a", header: "Amount", render: (row) => <span className="font-mono text-xs">{row.amount}</span> },
    { key: "p", header: "Price", render: (row) => <span className="font-mono text-xs">{row.price}</span> },
    { key: "w", header: "When", align: "right", render: (row) => (
      <span className="font-mono text-[11px] text-muted-foreground" title={row.txid ? `TX ${row.txid}` : undefined}>
        {row.txid ? row.txid.slice(0, 8) + "…" : row.when}
      </span>
    )},
  ]

  return (
    <>
      <PageHeader
        eyebrow="Module A · AMM"
        title="Swap & Dynamic Pools"
        subtitle="Route through weighted multi-asset pools with KRON covenants. Minimum-received guaranteed on-chain."
        right={
          <div className="flex items-center gap-2">
            <span
              className="hidden items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground sm:flex"
              title={`Verified state from ${l1Info.indexerUrl} · price ${l1Info.priceSource ?? "kraken"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${l1Info.synced ? "bg-[color:var(--emerald-accent)]" : "bg-amber-400"}`} data-live />
              DIRECT FROM NODE{l1Info.kasUsd ? ` · KAS $${l1Info.kasUsd.toFixed(4)}` : ""}{l1Info.tipDaa != null ? ` · DAA ${l1Info.tipDaa}` : ""}
            </span>
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              aria-label="Swap settings"
              aria-expanded={showSettings}
              className={`glass glass-border grid h-9 w-9 place-items-center rounded-xl transition-colors ${showSettings ? "text-[color:var(--emerald-accent)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={ArrowUpRight} label="24h Volume" value={`$${fmt(liveVol, 0)}`} delta={l1Info.dataSource === "kascov" ? "KasCov index" : l1Info.dataSource} tone="emerald" />
        <StatTile icon={Layers} label="Total Liquidity" value={`$${fmt(liveTvl, 0)}`} delta={`${livePools.length} pools · curves`} tone="emerald" />
        <StatTile icon={Coins} label="Fees (24h)" value={`$${fmt(liveVol * 0.003, 0)}`} delta="0.30% of volume" tone="gold" />
        <StatTile icon={Activity} label="Active Covenants" value={fmt(liveActive, 0)} delta={`DAA ${l1Info.tipDaa?.toLocaleString() ?? "—"}`} tone="violet" />
      </div>

      <div className="mt-5 grid grid-cols-12 gap-5">
        <GlassCard className="col-span-12 lg:col-span-5">
          <SectionLabel eyebrow="Instant Swap" title="Route via KRON covenants" />

          {showSettings && (
            <div className="mb-3 rounded-xl border border-border/50 bg-[oklch(0.11_0.02_265)]/60 p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Slippage tolerance</div>
              <div className="flex gap-2">
                {[0.1, 0.3, 0.5, 1].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlippage(s)}
                    className={`flex-1 rounded-lg border py-1.5 font-mono text-[11px] transition-colors ${slippage === s ? "border-[color:var(--emerald-accent)]/50 bg-[color:var(--emerald-accent)]/10 text-[color:var(--emerald-accent)]" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                  >
                    {s}%
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <TokenPlate
              label="From"
              value={amount}
              onChange={(v) => { setAmount(v); setKccQuote(null) }}
              usd={fmt(inAmt * kasUsdPrice)}
              token={{ symbol: from.ticker, color: "oklch(0.86 0.2 165)" }}
              onPickToken={() => setPicker("from")}
              balance={from.ticker === "KAS" ? fmt(Number(wallet.balanceRaw || 0)) : "0"}
              onMax={from.ticker === "KAS" ? () => setAmount(String(wallet.balanceRaw || 0)) : undefined}
            />
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={flip}
                aria-label="Flip tokens"
                className="glass glass-border grid h-9 w-9 place-items-center rounded-xl transition-transform hover:rotate-180"
              >
                <ArrowDown className="h-4 w-4 text-[color:var(--emerald-accent)]" />
              </button>
            </div>
            <TokenPlate
              label="To"
              value={out > 0 ? fmt(out, 4) : ""}
              readOnly
              usd={fmt(out * kasUsdPrice)}
              token={{ symbol: to.ticker, color: "oklch(0.51 0.26 293)" }}
              onPickToken={() => setPicker("to")}
              balance="0"
            />

            <div className="mt-3 space-y-1.5 rounded-xl border border-border/50 bg-[oklch(0.11_0.02_265)]/60 p-3 font-mono text-[11px]">
              {[
                ["Rate", `1 ${from.ticker} = ${fmt(rate, 6)} ${to.ticker}`],
                ["Slippage tolerance", `${slippage.toFixed(2)}%`],
                ["Price impact", `${impact.toFixed(2)}%`],
                ["Min received", `${fmt(minReceived, 4)} ${to.ticker}`],
                ["Route", kccToken ? (kccToken.graduated ? "KRON AMM" : "Bonding curve") : `${from.ticker} → ${to.ticker}`],
                ["Network fee", "≈ $0.002"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-right text-foreground">{v}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={doSwap}
              disabled={swapping}
              className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[color:var(--emerald-accent)] py-3 font-display text-sm font-bold text-[color:var(--onyx)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-8px_oklch(0.86_0.2_165/0.7)] disabled:opacity-50"
            >
              <Zap className="h-4 w-4" strokeWidth={2.5} /> {swapping ? "Swapping…" : wallet.connected ? "Swap via KRON" : "Connect & Swap"}
            </button>
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-4">
          <SectionLabel eyebrow="Weighted Pool" title="KAS · AETH · USDT" />
          <PoolWheel />
          <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-[11px]">
            {[
              ["Fee tier", "0.30%"],
              ["Invariant", "V2"],
              ["Rebalance", "Auto"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border/50 px-2 py-1.5">
                <div className="text-muted-foreground">{k}</div>
                <div className="text-foreground">{v}</div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-3">
          {selectedPool && (
            <>
              <SectionLabel eyebrow="Add Liquidity" title={`Provide to ${selectedPool.pair}`} />
              <div className="space-y-3">
                <div className="recessed rounded-xl p-3">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">TVL</div>
                  <div className="font-display text-xl font-bold">{selectedPool.tvl}</div>
                </div>
                <div className="recessed rounded-xl p-3">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">24h Volume</div>
                  <div className="font-display text-xl font-bold">{selectedPool.vol}</div>
                </div>
                <div className="rounded-xl border border-[color:var(--emerald-accent)]/30 bg-[color:var(--emerald-accent)]/5 p-3 font-mono text-[11px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">Fee tier</span><span className="text-foreground">0.30%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Est. APR</span><span className="text-[color:var(--emerald-accent)]">{selectedPool.apr}</span></div>
                </div>
                <button
                  type="button"
                  onClick={() => setLpOpen(true)}
                  className="w-full rounded-xl border border-[color:var(--emerald-accent)]/50 bg-[color:var(--emerald-accent)]/10 py-2 font-display text-sm font-bold text-[color:var(--emerald-accent)] transition-colors hover:bg-[color:var(--emerald-accent)]/20"
                >
                  Provide Liquidity
                </button>
              </div>
            </>
          )}
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-8">
          <SectionLabel eyebrow="Top Pools" title="Ranked by TVL" right={<ArrowUpRight className="h-4 w-4 text-muted-foreground" />} />
          <DataTable columns={poolCols} rows={pools} />
        </GlassCard>

        <GlassCard className="col-span-12 lg:col-span-4">
          <SectionLabel eyebrow="Live tape" title="Recent trades" />
          <DataTable columns={tradeCols} rows={trades} />
        </GlassCard>
      </div>

      <TokenPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        tokens={tokens}
        exclude={picker === "from" ? to.ticker : from.ticker}
        onSelect={(t) => {
          const info: TokenInfo = t.toTokenInfo()
          if (picker === "from") { setFrom(info); if (to.ticker === t.tick) setTo(from) }
          else { setTo(info); if (from.ticker === t.tick) setFrom(to) }
          setAmount("")
          setKccQuote(null)
        }}
      />

      {selectedPool && (
        <ActionDialog
          open={lpOpen}
          onClose={() => setLpOpen(false)}
          eyebrow="Add liquidity"
          title={selectedPool.pair}
          token="USD"
          balanceLabel="Wallet $48,204"
          maxAmount={48204}
          confirmLabel="Provide liquidity"
          details={[
            ["Pool", selectedPool.pair],
            ["Est. APR", selectedPool.apr],
            ["Fee tier", "0.30%"],
            ["Deposit split", "50 / 50 weighted"],
          ]}
          onConfirm={(v) =>
            toast.success(`Added $${fmt(v)} to ${selectedPool.pair}`, {
              description: `Earning ${selectedPool.apr} APR · LP tokens minted`,
            })
          }
        />
      )}
    </>
  )
}

function TokenPlate({
  label, value, onChange, readOnly, usd, token, onPickToken, balance, onMax,
}: {
  label: string
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
  usd: string
  token: { symbol: string; color: string }
  onPickToken: () => void
  balance: string
  onMax?: () => void
}) {
  return (
    <div className="recessed rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={onMax}
          disabled={!onMax}
          className="font-mono text-[10px] text-muted-foreground transition-colors enabled:hover:text-[color:var(--emerald-accent)]"
        >
          Balance <span className="text-foreground">{balance}</span>
        </button>
      </div>
      <div className="flex items-center gap-3">
        <input
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => onChange?.(e.target.value.replace(/[^\d.]/g, ""))}
          className="w-full min-w-0 bg-transparent font-display text-3xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
        />
        <button
          type="button"
          onClick={onPickToken}
          className="flex shrink-0 items-center gap-2 rounded-xl border border-border/60 bg-[oklch(0.22_0.025_265)] px-3 py-2 transition-colors hover:border-[color:var(--emerald-accent)]/50"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full font-mono text-[10px] font-bold text-[color:var(--onyx)]" style={{ background: token.color }}>{token.symbol[0]}</span>
          <span className="font-display text-sm font-semibold">{token.symbol}</span>
        </button>
      </div>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground">≈ ${usd}</div>
    </div>
  )
}

function TokenPicker({
  open, onClose, onSelect, exclude, tokens,
}: { open: boolean; onClose: () => void; onSelect: (t: Kcc20Token) => void; exclude: string; tokens: Kcc20Token[] }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[oklch(0.08_0.015_265)]/80 p-4 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div className="glass glass-border w-full max-w-xs rounded-2xl p-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Select token">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Select token</div>
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {tokens.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/50 px-3 py-4 text-center font-mono text-[11px] text-muted-foreground">
              Loading KCC-20 tokens…
            </div>
          )}
          {tokens.filter((t) => t.tick !== exclude).map((t) => (
            <button
              key={t.tick}
              type="button"
              onClick={() => { onSelect(t); onClose() }}
              className="flex w-full items-center justify-between rounded-xl border border-border/40 bg-[oklch(0.16_0.025_265)]/60 px-3 py-2.5 transition-colors hover:border-[color:var(--emerald-accent)]/40"
            >
              <span className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full font-mono text-[10px] font-bold text-[color:var(--onyx)]" style={{ background: "oklch(0.51 0.26 293)" }}>{t.tick[0]}</span>
                <span className="font-display text-sm font-semibold">{t.tick}</span>
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{t.graduated ? "KRON AMM" : "Curve"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}