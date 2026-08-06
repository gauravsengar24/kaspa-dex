import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import {
  Rocket, Check, X, Loader2, AlertTriangle, ExternalLink, Sparkles, Image as ImageIcon,
  PlusCircle, Import as ImportIcon, ShieldCheck,
} from "lucide-react"
import { GlassCard, SectionLabel } from "./aetheris/GlassCard"
import {
  fetchLaunchFee, checkTickAvailable, checkImageUrl, listRegistryTokens,
  resolveImport, registerImport,
  type LaunchFee, type RegistryToken, type SelfReported,
} from "../utils/kron"
import { useKaspaWallet } from "../hooks/useKaspaWallet"
import { formatKaspa } from "../utils/kaspa"
import { cn } from "../lib/utils"

const TICK_RE = /^[a-z0-9][a-z0-9]{1,11}$/
const MAX_SUPPLY = 1_000_000_000

type LaunchStep = "form" | "import"

function SparklesIcon() {
  return <Sparkles size={15} className="text-kaspa-gold" />
}

export default function Launchpad() {
  const { connected, address } = useKaspaWallet()
  const [step, setStep] = useState<LaunchStep>("form")

  /* form state */
  const [tick, setTick] = useState("")
  const [name, setName] = useState("")
  const [supply, setSupply] = useState("1000000")
  const [description, setDescription] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [website, setWebsite] = useState("")
  const [x, setX] = useState("")
  const [telegram, setTelegram] = useState("")

  /* live validation */
  const [fee, setFee] = useState<LaunchFee | null>(null)
  const [tickCheck, setTickCheck] = useState<{ available: boolean; reason?: string; checking: boolean }>({ available: false, checking: false })
  const [imageCheck, setImageCheck] = useState<"ok" | "bad" | "checking" | "none">("none")
  const [recent, setRecent] = useState<RegistryToken[]>([])
  const [recentLoading, setRecentLoading] = useState(true)

  /* import state */
  const [importTxid, setImportTxid] = useState("")
  const [imported, setImported] = useState<{ covid: string; token?: string } | null>(null)
  const [importing, setImporting] = useState(false)

  const tickDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const imageDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tickValid = TICK_RE.test(tick)
  const tickOk = tickCheck.available === true
  const nameOk = name.trim().length >= 2
  const supplyNum = Number(supply)
  const supplyOk = Number.isFinite(supplyNum) && supplyNum > 0 && supplyNum <= MAX_SUPPLY
  const formValid = tickValid && tickOk && nameOk && supplyOk

  const loadRecent = useCallback(async () => {
    try {
      const tokens = await listRegistryTokens()
      setRecent((Array.isArray(tokens) ? tokens : []).slice(0, 12))
    } catch {
      setRecent([])
    } finally {
      setRecentLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLaunchFee().then(setFee)
    loadRecent()
    const poll = setInterval(loadRecent, 30_000)
    return () => clearInterval(poll)
  }, [loadRecent])

  useEffect(() => {
    if (!tick) { setTickCheck({ available: false, checking: false }); return }
    if (!TICK_RE.test(tick)) { setTickCheck({ available: false, reason: "2-12 lowercase letters or digits", checking: false }); return }
    if (tickDebounce.current) clearTimeout(tickDebounce.current)
    setTickCheck({ available: false, checking: true })
    tickDebounce.current = setTimeout(async () => {
      const res = await checkTickAvailable(tick)
      setTickCheck({ available: res?.available === true, reason: res?.reason, checking: false })
    }, 350)
    return () => { if (tickDebounce.current) clearTimeout(tickDebounce.current) }
  }, [tick])

  useEffect(() => {
    if (!imageUrl || !imageUrl.startsWith("http")) { setImageCheck("none"); return }
    if (imageDebounce.current) clearTimeout(imageDebounce.current)
    setImageCheck("checking")
    imageDebounce.current = setTimeout(async () => {
      const res = await checkImageUrl(imageUrl)
      setImageCheck(res?.ok ? "ok" : "bad")
    }, 450)
    return () => { if (imageDebounce.current) clearTimeout(imageDebounce.current) }
  }, [imageUrl])

  /** On-chain deploy contract runs on the KRON platform; hand off with the validated params. */
  const handleLaunch = () => {
    if (!formValid) return
    const qs = new URLSearchParams({
      tick, name, supply, image: imageUrl || "",
    })
    window.open(`https://kron.technology/launch/new?${qs.toString()}`, "_blank", "noopener")
    toast.info("On-chain deploy handed to the KRON platform")
  }

  /** Import an already-deployed KCC-20 token: resolve txid → register with canonical manifest. */
  const handleImportTx = async () => {
    const txid = importTxid.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      toast.error("Enter a valid 64-character txid")
      return
    }
    setImporting(true)
    try {
      const resolved = await resolveImport(txid)
      if (!resolved?.covid && !resolved?.params) throw new Error("Could not resolve a KCC-20 token from this txid")
      const covid = String(resolved.covid ?? "")
      const tickGuess = String(resolved.tick ?? resolved.symbol ?? covid.slice(0, 12)).toLowerCase()

      const selfReported: SelfReported = { symbol: tickGuess }
      const reg = await registerImport(txid, selfReported, covid)
      setImported({ covid, token: reg.tick ?? tickGuess })
      toast.success("Token registered on the launch ledger")
      loadRecent()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed")
    } finally {
      setImporting(false)
    }
  }

  const tickHint = !tickValid
    ? "2-12 lowercase letters/digits"
    : tickCheck.checking
      ? "Checking availability…"
      : tickOk
        ? "Available on the KRON ledger"
        : `Unavailable — ${tickCheck.reason ?? "already registered"}`

  const tickHintStyle = !tickValid || (!tickOk && !tickCheck.checking)
    ? "text-kaspa-red"
    : tickCheck.checking
      ? "text-kaspa-gold"
      : "text-kaspa-green"

  return (
    <div className="space-y-6">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-kaspa-gold">
          KRON Launchpad · KCC-20
        </div>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Launchpad</h1>
        <p className="mt-1 font-mono text-[11px] text-kaspa-muted">
          Launch a KCC-20 token in a few clicks — validated live against the KRON registry
        </p>
      </div>

      {/* fee policy banner */}
      {fee?.feePolicy && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-kaspa-gold/20 bg-kaspa-gold/5 px-4 py-3 font-mono text-[11px] text-kaspa-muted">
          <span className="flex items-center gap-1.5">
            <Rocket size={12} className="text-kaspa-pink" />
            Launch fee <b className="text-foreground">{formatKaspa(Number(fee.sompi) / 1e8)} KAS</b>
            <span className="text-muted-foreground">(≈${fee.usd})</span>
          </span>
          <span><b className="text-foreground">{fee.feePolicy.creatorFeeBps} bps</b> creator</span>
          <span><b className="text-foreground">{fee.feePolicy.platformFeeBps} bps</b> platform</span>
          <span><b className="text-foreground">{fee.feePolicy.devFundBps} bps</b> devFund</span>
          <span><b className="text-foreground">{fee.feePolicy.graduationFeeBps} bps</b> graduation</span>
          <span><b className="text-foreground">{fee.feePolicy.dexLpFeeBps} bps</b> LP</span>
          {fee.feePolicy.enforced !== false && <span className="text-kaspa-gold">fee enforced on-chain</span>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* creator panel */}
        <GlassCard className="lg:col-span-3">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                KCC-20 · conformant
              </div>
              <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-foreground">
                {step === "form" ? "Launch new token" : "Register existing token"}
              </h2>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("form")}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors", step === "form" ? "glass text-foreground" : "text-kaspa-muted hover:text-foreground")}>
                <span className="flex items-center gap-1.5"><PlusCircle size={13} /> Launch</span>
              </button>
              <button onClick={() => setStep("import")}
                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors", step === "import" ? "glass text-foreground" : "text-kaspa-muted hover:text-foreground")}>
                <span className="flex items-center gap-1.5"><ImportIcon size={13} /> Import</span>
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {step === "form" ? (
              <motion.div key="form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
                {/* tick */}
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Ticker</label>
                  <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5",
                    tickCheck.checking ? "border-kaspa-gold/40" : tickOk ? "border-kaspa-green/40" : "border-kaspa-red/30")}>
                    <SparklesIcon />
                    <input value={tick} onChange={(e) => setTick(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                      placeholder="e.g. kaspadog"
                      className="w-full bg-transparent font-mono text-sm font-semibold uppercase tracking-wider outline-none placeholder:font-normal placeholder:normal-case placeholder:text-muted-foreground"
                    />
                    {tickCheck.checking ? <Loader2 size={15} className="animate-spin text-kaspa-gold" />
                      : tickValid ? (tickOk ? <Check size={15} className="text-kaspa-green" /> : <X size={15} className="text-kaspa-red" />) : null}
                  </div>
                  <p className={cn("mt-1 font-mono text-[10px]", tickHintStyle)}>
                    {tickHint}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Name</label>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kaspadog" maxLength={40}
                      className={cn("w-full rounded-xl border px-3 py-2.5 text-sm outline-none", nameOk ? "border-kaspa-gold/20" : "border-kaspa-red/30")} />
                  </div>
                  <div>
                    <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Total supply</label>
                    <input value={supply} onChange={(e) => /^\d*(\.\d{0,4})?$/.test(e.target.value) && setSupply(e.target.value)}
                      placeholder="1,000,000"
                      className={cn("w-full rounded-xl border px-3 py-2.5 font-mono text-sm outline-none", supplyOk ? "border-kaspa-gold/20" : "border-kaspa-red/30")}
                    />
                    <p className={cn("mt-1 font-mono text-[10px]", supplyOk ? "text-muted-foreground" : "text-kaspa-red")}>
                      max {MAX_SUPPLY.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Description</label>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={600}
                    placeholder="What are you building?" className="w-full resize-none rounded-xl border border-kaspa-gold/15 px-3 py-2.5 text-sm outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <ImageIcon size={12} /> Image URL
                  </label>
                  <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5",
                    imageCheck === "checking" ? "border-kaspa-gold/40" : imageCheck === "ok" ? "border-kaspa-green/40" : imageCheck === "bad" ? "border-kaspa-red/30" : "border-kaspa-gold/15")}>
                    <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…"
                      className="w-full bg-transparent font-mono text-sm outline-none"
                    />
                    {imageCheck === "checking" ? <Loader2 size={15} className="animate-spin text-kaspa-gold" />
                      : imageCheck === "ok" ? <Check size={15} className="text-kaspa-green" />
                      : imageCheck === "bad" ? <AlertTriangle size={15} className="text-kaspa-red" /> : null}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {imageCheck === "ok" ? "Image reachable & valid" : imageCheck === "bad" ? "Image failed validation" : "Validated against the KRON CDN"}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  {(["Website", "X / Twitter", "Telegram"] as const).map((label, i) => (
                    <div key={label}>
                      <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</label>
                      <input
                        value={[website, x, telegram][i]}
                        onChange={(e) => [setWebsite, setX, setTelegram][i](e.target.value)}
                        placeholder={i === 0 ? "https://site.io" : i === 1 ? "@handle" : "t.me/…"}
                        className="w-full rounded-xl border border-kaspa-gold/15 px-3 py-2 sm:text-sm text-base outline-none"
                      />
                    </div>
                  ))}
                </div>

                <button onClick={handleLaunch} disabled={!formValid}
                  className={cn("btn-primary w-full", !formValid && "opacity-40")}>
                  <Rocket size={16} />
                  {!formValid ? "Complete the form to launch" : connected ? "Continue — hand off to KRON platform" : "Wire wallet to hand off"}
                </button>
                <p className="text-center font-mono text-[9px] text-muted-foreground">
                  Deploy is non-custodial and executes on the KRON platform; your ticker stays reserved. After deploy, switch to Import to list it here.
                </p>
              </motion.div>
            ) : (
              <motion.div key="import" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
                <p className="font-mono text-[11px] text-muted-foreground">
                  Have a KCC-20 token already deployed on-chain? Provide its deploy txid and register it on the ledger.
                </p>
                <div>
                  <label className="mb-1 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Deploy transaction id</label>
                  <input value={importTxid} onChange={(e) => setImportTxid(e.target.value)} placeholder="64-hex txid…"
                    className="w-full rounded-xl border border-kaspa-gold/15 px-3 py-2.5 font-mono text-sm outline-none"
                  />
                </div>
                <button onClick={handleImportTx} disabled={!/^[0-9a-f]{64}$/.test(importTxid.trim()) || importing}
                  className={cn("btn-primary", !/^[0-9a-f]{64}$/.test(importTxid.trim()) && "opacity-40")}>
                  {importing ? <Loader2 size={16} className="animate-spin" /> : <ImportIcon size={16} />}
                  Resolve & register
                </button>
                {imported && (
                  <div className="rounded-xl border border-kaspa-green/30 bg-kaspa-green/5 p-3 font-mono text-[11px] text-kaspa-green">
                    Registered {imported.token ? <b>{imported.token}</b> : <>covenant</>}{" "}
                    <span className="break-all">{imported.covid}</span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>

        {/* recent launches / verified feed */}
        <GlassCard className="lg:col-span-2">
          <SectionLabel eyebrow="Live Registry" title="Recent launches" />
          {recentLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-shimmer rounded-xl bg-ink/60" />)}
            </div>
          ) : recent.length === 0 ? (
            <div className="text-center py-8 text-kaspa-muted">
              <ShieldCheck size={28} className="mx-auto mb-2 opacity-60" />
              <p className="font-mono text-[11px]">No launches yet</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {recent.map((t, i) => {
                const tickKey = String((t.tick ?? t.selfReported?.symbol ?? t.covid ?? "").toLowerCase())
                return (
                  <div key={`${tickKey}-${i}`} className="flex items-center gap-3 rounded-xl border border-kaspa-gold/10 bg-background/40 p-3 transition-colors hover:border-kaspa-gold/30">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-kaspa-gold/30 to-kaspa-pink/30 font-mono text-[11px] font-bold uppercase text-foreground">
                      {(t.tick ?? t.symbol ?? t.covid ?? "?").slice(0, 3)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold text-foreground">
                        {(t.tick ?? t.symbol ?? t.covid?.slice(0, 6))?.toUpperCase()}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {t.name ?? t.covid?.slice(0, 18) ?? "…"}
                      </p>
                    </div>
                    {t.covid && (
                      <a href={`https://kronscan.io/${t.covid}`} target="_blank" rel="noreferrer"
                        className="text-muted-foreground transition-colors hover:text-foreground">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  )
}