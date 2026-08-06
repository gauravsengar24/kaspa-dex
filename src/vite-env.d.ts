/// <reference types="vite/client" />

interface KasWareBalance {
  confirmed: string
  unconfirmed: string
  total: string
}

interface KasWareKrc20Token {
  tick: string
  balance: string
  dec: string
  locked: string
  opScoreMod: string
  tokenType: string
  priceInKas?: number
}

interface KasWareProvider {
  isKasWare: boolean
  requestAccounts: () => Promise<string[]>
  getAccounts: () => Promise<string[]>
  getBalance: () => Promise<KasWareBalance | null>
  getKRC20Balance: () => Promise<KasWareKrc20Token[] | null>
  getPublicKey: () => Promise<string>
  getNetwork: () => Promise<string>
  getVersion: () => Promise<string>
  switchNetwork: (network: string) => Promise<void>
  disconnect: (origin: string) => Promise<void>
  sendKaspa: (toAddress: string, sompi: number, options?: { priorityFee?: number; payload?: string }) => Promise<string>
  signPskt: (params: { txJsonString: string; options?: { signInputs?: { index: number; sighashType?: number }[] } }) => Promise<string>
  signMessage: (message: string) => Promise<string>
  getXOnlyPublicKey: () => Promise<string>
  pushTx: (txJson: string) => Promise<string>
  getUtxoEntries: (address?: string) => Promise<any[]>
  on: (event: "accountsChanged" | "networkChanged", callback: (...args: any[]) => void) => void
}

interface Window {
  kasware?: KasWareProvider
  kaspa?: {
    isKasWare?: boolean
    isKaspa?: boolean
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    on: (event: string, callback: (...args: unknown[]) => void) => void
  }
}
