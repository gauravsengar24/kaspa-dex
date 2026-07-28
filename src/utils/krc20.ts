import { NETWORK, KASPA_TOKEN } from "./constants"
import type { TokenInfo } from "../types"
import { loadSession } from "./kaspa"

const SOMPI_PER_KAS = 100_000_000
const KASPLEX_API = "https://api.kasplex.org/v1"

export interface Krc20Balance {
  tick: string
  balance: string
  dec: string
  locked: string
  opScoreMod: string
}

export interface Krc20TransferResult {
  commitId: string
  revealId: string
  status: "pending" | "confirmed" | "failed"
}

export interface Krc20TokenMeta {
  tick: string
  max: string
  lim: string
  dec: string
  minted: string
  state: "deployed" | "finished" | "burned"
}

export async function getKrc20Balances(address: string): Promise<Krc20Balance[]> {
  if (window.kasware?.getKRC20Balance) {
    try {
      const result = await window.kasware.getKRC20Balance()
      if (Array.isArray(result)) return result
    } catch { }
  }
  try {
    const res = await fetch(`${KASPLEX_API}/krc20/address/${address}/tokenlist`)
    if (res.ok) {
      const data = await res.json()
      return (data.result || []).map((t: any) => ({
        tick: t.tick,
        balance: t.balance,
        dec: t.dec || "8",
        locked: "0",
        opScoreMod: t.opScoreMod || "",
      }))
    }
  } catch { }
  return []
}

export async function getKrc20TokenMeta(tick: string): Promise<Krc20TokenMeta | null> {
  try {
    const res = await fetch(`${KASPLEX_API}/krc20/${tick}`)
    if (res.ok) {
      const data = await res.json()
      const r = data.result
      return {
        tick: r.tick,
        max: r.max,
        lim: r.lim,
        dec: r.dec || "8",
        minted: r.minted,
        state: r.state,
      }
    }
  } catch { }
  return null
}

export function parseKrc20Balance(balance: string, decimals: string): number {
  return Number(balance) / Math.pow(10, Number(decimals))
}

export function formatKrc20Balance(balance: string, decimals: string): string {
  const val = parseKrc20Balance(balance, decimals)
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(2) + "M"
  if (val >= 1_000) return (val / 1_000).toFixed(2) + "K"
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })
}

export async function transferKrc20(
  tick: string,
  amount: string,
  destinationAddress: string,
  priorityFee: number = 0.1
): Promise<Krc20TransferResult> {
  const provider = (window as any).kasware
  if (!provider?.signKRC20Transaction) {
    throw new Error("KasWare wallet does not support KRC-20 transfers (signKRC20Transaction)")
  }

  const transferData = JSON.stringify({
    p: "KRC-20",
    op: "transfer",
    tick,
    amt: amount,
    to: destinationAddress,
  })

  const result = await provider.signKRC20Transaction(
    transferData,
    4,
    destinationAddress,
    priorityFee,
  )

  const parsed = JSON.parse(result)
  return {
    commitId: parsed.commitId || "",
    revealId: parsed.revealId || "",
    status: "pending",
  }
}

export function getTotalKrc20Balance(ticker: string, balances: Krc20Balance[]): number {
  const match = balances.find((b) => b.tick.toUpperCase() === ticker.toUpperCase())
  if (!match) return 0
  return parseKrc20Balance(match.balance, match.dec)
}

export async function krc20TokenToTokenInfo(balance: Krc20Balance): Promise<TokenInfo> {
  return {
    ticker: balance.tick,
    name: balance.tick,
    decimals: Number(balance.dec || "8"),
    icon: "🪙",
    address: undefined,
    isKrc20: true,
  }
}

export const KRC20_TOKEN_CACHE: Record<string, Krc20TokenMeta> = {}

export async function prefetchKrc20Tokens(address: string): Promise<void> {
  try {
    const res = await fetch(`${KASPLEX_API}/krc20/address/${address}/tokenlist`)
    if (res.ok) {
      const data = await res.json()
      for (const t of data.result || []) {
        KRC20_TOKEN_CACHE[t.tick] = {
          tick: t.tick,
          max: t.max || "0",
          lim: t.lim || "0",
          dec: t.dec || "8",
          minted: t.minted || "0",
          state: t.state || "deployed",
        }
      }
    }
  } catch { }
}
