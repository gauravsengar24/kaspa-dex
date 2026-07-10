import type { WalletState } from "../types"

const SOMPI_PER_KAS = 100_000_000
const STORAGE_KEY = "kaspadex_wallet"

let _kaswareVersion: string | undefined

export function saveSession(address: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ address }))
  } catch { /* noop */ }
}

export function loadSession(): { address: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.address) return parsed
    return null
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* noop */ }
}

export async function tryRestoreProvider(timeout = 2000): Promise<KasWareProvider | null> {
  try {
    if (detectKasWare()) return resolveProvider()
    const found = await waitForProvider(timeout)
    if (!found) return null
    return resolveProvider()
  } catch {
    return null
  }
}

export function detectKasWare(): boolean {
  if (typeof window === "undefined") return false
  if (window.kasware !== undefined) return true
  if (window.kaspa !== undefined) return true
  return false
}

export function waitForProvider(timeout = 4000): Promise<boolean> {
  const promise = new Promise<boolean>((resolve) => {
    // fast path: already injected
    if (detectKasWare()) {
      resolve(true)
      return
    }
    const start = Date.now()
    const check = () => {
      if (detectKasWare()) {
        resolve(true)
        return
      }
      if (Date.now() - start > timeout) {
        resolve(false)
        return
      }
      setTimeout(check, 200)
    }
    check()
  })
  // don't cache — every call gets a fresh attempt
  return promise
}

function resolveProvider(): KasWareProvider | null {
  if (window.kasware !== undefined) return window.kasware

  if (window.kaspa !== undefined && typeof window.kaspa.request === "function") {
    const legacy = window.kaspa
    return {
      isKasWare: true,
      requestAccounts: async () => {
        const result = await legacy.request({ method: "requestAccounts" })
        return result as string[]
      },
      getAccounts: async () => {
        const result = await legacy.request({ method: "getAccounts" })
        return result as string[]
      },
      getBalance: async () => {
        const result = await legacy.request({ method: "getBalance" })
        return result as KasWareBalance | null
      },
      getKRC20Balance: async () => {
        const result = await legacy.request({ method: "getKRC20Balance" })
        return result as KasWareKrc20Token[] | null
      },
      getPublicKey: async () => {
        const result = await legacy.request({ method: "getPublicKey" })
        return result as string
      },
      getNetwork: async () => {
        const result = await legacy.request({ method: "getNetwork" })
        return result as string
      },
      getVersion: async () => "",
      switchNetwork: async (n: string) => {
        await legacy.request({ method: "switchNetwork", params: [n] })
      },
      disconnect: async (origin: string) => {
        await legacy.request({ method: "disconnect", params: [origin] })
      },
      sendKaspa: async (to: string, amt: number, opts?: any) => {
        return legacy.request({ method: "sendKaspa", params: [to, amt, opts] }) as Promise<string>
      },
      signPskt: async (params: any) => {
        return legacy.request({ method: "signPskt", params: [params] }) as Promise<string>
      },
      pushTx: async (tx: string) => {
        return legacy.request({ method: "pushTx", params: [tx] }) as Promise<string>
      },
      getUtxoEntries: async (addr?: string) => {
        return legacy.request({ method: "getUtxoEntries", params: addr ? [addr] : [] }) as Promise<any[]>
      },
      on: (event, cb) => legacy.on(event, cb as any),
    }
  }

  return null
}

export async function ensureProvider(): Promise<KasWareProvider> {
  const found = await waitForProvider()
  if (!found) throw new Error("KasWare wallet extension not detected")
  const p = resolveProvider()
  if (!p) throw new Error("KasWare wallet extension not detected")
  try {
    _kaswareVersion = await p.getVersion()
  } catch { /* ignore */ }
  return p
}

export async function connectWallet(): Promise<WalletState> {
  const p = await ensureProvider()
  const accounts = await p.requestAccounts()
  if (!accounts || accounts.length === 0) throw new Error("No accounts returned")
  const address = accounts[0]
  const balanceData = await p.getBalance()
  const balance = balanceData?.total ? Number(balanceData.total) / SOMPI_PER_KAS : 0
  saveSession(address)
  try {
    const evm = (window as any).kasware?.ethereum
    if (evm) await evm.request({ method: "eth_requestAccounts", params: [] })
  } catch { /* EVM authorization optional */ }
  return { address, balance, connected: true, connecting: false }
}

export async function refreshWalletBalance(address: string): Promise<number> {
  try {
    const p = await ensureProvider()
    const balanceData = await p.getBalance()
    return balanceData?.total ? Number(balanceData.total) / SOMPI_PER_KAS : 0
  } catch {
    return 0
  }
}

export async function disconnectWallet(): Promise<void> {
  clearSession()
  try {
    const p = await ensureProvider()
    await p.disconnect(window.location.origin)
  } catch { /* ignore */ }
}

export async function getKRC20Balances(): Promise<KasWareKrc20Token[]> {
  try {
    const p = await ensureProvider()
    const balances = await p.getKRC20Balance()
    return balances || []
  } catch {
    return []
  }
}

export function isKasWareInstalled(): boolean {
  return detectKasWare()
}

export function getKasWareVersion(): string | undefined {
  return _kaswareVersion
}

export function onAccountsChanged(callback: (accounts: string[]) => void): () => void {
  const p = resolveProvider()
  if (!p) return () => {}
  try {
    p.on("accountsChanged", callback)
  } catch { /* ignore */ }
  return () => {}
}

export function onNetworkChanged(callback: (network: string) => void): () => void {
  const p = resolveProvider()
  if (!p) return () => {}
  try {
    p.on("networkChanged", callback)
  } catch { /* ignore */ }
  return () => {}
}

export function formatKaspa(amount: number): string {
  if (amount >= 1_000_000) return (amount / 1_000_000).toFixed(2) + "M"
  if (amount >= 1_000) return (amount / 1_000).toFixed(2) + "K"
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0.00"
  if (v >= 1) return "$" + v.toFixed(2)
  if (v >= 0.01) return "$" + v.toFixed(4)
  if (v >= 0.0001) return "$" + v.toFixed(6)
  return "$" + v.toExponential(2)
}

export function formatAddress(addr: string): string {
  if (!addr || addr.length <= 12) return addr || ""
  const prefix = addr.startsWith("kaspa:") ? "kaspa:" : ""
  const body = prefix ? addr.slice(6) : addr
  if (body.length <= 12) return addr
  return `${prefix}${body.slice(0, 6)}...${body.slice(-6)}`
}

export function computeSwapOutput(
  inputAmount: number,
  inputReserve: number,
  outputReserve: number,
  feePercent: number
): number {
  const fee = inputAmount * (feePercent / 100)
  const effectiveInput = inputAmount - fee
  const numerator = effectiveInput * outputReserve
  const denominator = inputReserve + effectiveInput
  return numerator / denominator
}
