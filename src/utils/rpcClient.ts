import { NETWORK } from "./constants"

const SOMPI_PER_KAS = 100_000_000
const REST_API = NETWORK.rest || "https://api.kaspa.org"

export async function getBalanceByRpc(address: string): Promise<number> {
  try {
    if (window.kasware?.getBalance) {
      const bal = await window.kasware.getBalance()
      if (bal?.total) return Number(bal.total) / SOMPI_PER_KAS
    }
  } catch { }
  try {
    const res = await fetch(`${REST_API}/addresses/${address}/balance`)
    if (res.ok) {
      const data = await res.json()
      return (data.balance || 0) / SOMPI_PER_KAS
    }
  } catch { }
  return 0
}

export async function getUtxosByRpc(address: string): Promise<any[]> {
  try {
    if (window.kasware?.getUtxoEntries) {
      const entries = await window.kasware.getUtxoEntries(address)
      if (entries?.length) return entries
    }
  } catch { }
  try {
    const res = await fetch(`${REST_API}/addresses/${address}/utxos`)
    if (res.ok) {
      const data = await res.json()
      return data || []
    }
  } catch { }
  return []
}

export async function getTransactionStatusRpc(txId: string): Promise<any> {
  try {
    const res = await fetch(`${REST_API}/transactions/${txId}`)
    if (res.ok) {
      return await res.json()
    }
  } catch { }
  return null
}

export function isRpcConnected(): boolean {
  return true
}
