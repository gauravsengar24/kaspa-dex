import { useState, useCallback, useEffect, useRef } from "react"
import type { WalletState } from "../types"
import {
  connectWallet,
  disconnectWallet,
  refreshWalletBalance,
  onAccountsChanged,
  onNetworkChanged,
  getProvider,
  awaitProviderLate,
  getKasWareVersion,
  getKRC20Balances,
  formatKaspa,
  loadSession,
  clearSession,
} from "../utils/kaspa"

const initialState: WalletState = {
  address: "",
  balance: 0,
  connected: false,
  connecting: false,
}

export function useKaspaWallet() {
  const [wallet, setWallet] = useState<WalletState>(initialState)
  const [kaswareDetected, setKaswareDetected] = useState(false)
  const [kaswareVersion, setKaswareVersion] = useState<string | undefined>()
  const [detecting, setDetecting] = useState(true)
  const [networkName, setNetworkName] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [krc20Balances, setKrc20Balances] = useState<Record<string, number>>({})
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false

    const fetchKrc20 = async () => {
      try {
        const tokens = await getKRC20Balances()
        if (mountedRef.current) {
          const map: Record<string, number> = {}
          for (const t of tokens) {
            map[t.tick] = Number(t.balance) / Math.pow(10, Number(t.dec || 8))
          }
          setKrc20Balances(map)
        }
      } catch { /* balances are cosmetic — never block */ }
    }

    /** Silent connect: `getAccounts()` returns WITHOUT a wallet popup, so this is
     *  safe to run in the background. A saved session must still match, otherwise
     *  we only re-enable the wallet for an already-authorized account. */
    const silentlyConnect = async (p: KasWareProvider) => {
      const saved = loadSession()
      try {
        const accounts = await p.getAccounts()
        let address: string | null = null
        if (Array.isArray(accounts) && accounts.length > 0) {
          if (saved && accounts[0] === saved.address) {
            address = accounts[0]
          } else if (!saved) {
            address = accounts[0]
          }
        }
        if (!address) return

        const balance = await refreshWalletBalance(address)
        if (cancelled) return
        if (mountedRef.current) {
          setWallet({ address, balance, connected: true, connecting: false })
        }
        void fetchKrc20()
      } catch {
        /* wallet locked / not authorized — stay disconnected */
      }
    }

    const init = async () => {
      // Fast single resolve (cached, shared with every other caller).
      const p = await getProvider()
      if (cancelled) return

      if (mountedRef.current) {
        setKaswareDetected(!!p)
        setKaswareVersion(getKasWareVersion())
        setDetecting(false)
      }

      if (p) {
        await silentlyConnect(p)
        return
      }

      // Extension injecting slowly: keep the pill in sync WITHOUT blocking the UI,
      // then auto-connect once it turns up. Worst case ~1.5s for the first state.
      void awaitProviderLate(8000).then((late) => {
        if (cancelled || !late) return
        if (mountedRef.current) {
          setKaswareDetected(true)
          setKaswareVersion(getKasWareVersion())
        }
        void silentlyConnect(late)
      }).catch(() => {})
    }

    init()

    const unsub1 = onAccountsChanged(async (accounts) => {
      if (!accounts || accounts.length === 0) {
        if (mountedRef.current) { setWallet(initialState); clearSession(); setKrc20Balances({}) }
      } else {
        const balance = await refreshWalletBalance(accounts[0])
        if (mountedRef.current) {
          setWallet({ address: accounts[0], balance, connected: true, connecting: false })
        }
        const tokens = await getKRC20Balances()
        if (mountedRef.current) {
          const map: Record<string, number> = {}
          for (const t of tokens) map[t.tick] = Number(t.balance) / Math.pow(10, Number(t.dec || 8))
          setKrc20Balances(map)
        }
      }
    })

    const unsub2 = onNetworkChanged((network) => {
      if (mountedRef.current) setNetworkName(network)
    })

    return () => {
      cancelled = true
      unsub1()
      unsub2()
    }
  }, [])

  const refreshKrc20Balances = useCallback(async () => {
    const tokens = await getKRC20Balances()
    if (mountedRef.current) {
      const map: Record<string, number> = {}
      for (const t of tokens) map[t.tick] = Number(t.balance) / Math.pow(10, Number(t.dec || 8))
      setKrc20Balances(map)
    }
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    setWallet((prev) => ({ ...prev, connecting: true }))
    try {
      const state = await connectWallet()
      if (mountedRef.current) {
        setKaswareDetected(true)
        setWallet(state)
        setDetecting(false)
        setError(null)
      }
      await refreshKrc20Balances()
    } catch (err) {
      if (mountedRef.current) {
        setWallet((prev) => ({ ...prev, connecting: false }))
        setDetecting(false)
        const msg = err instanceof Error ? err.message : "Connection failed"
        setError(msg)
      }
    }
  }, [refreshKrc20Balances])

  const disconnect = useCallback(async () => {
    await disconnectWallet()
    if (mountedRef.current) {
      setWallet(initialState)
      setError(null)
      setKrc20Balances({})
    }
  }, [])

  const refreshBalance = useCallback(async () => {
    if (!wallet.connected || !wallet.address) return
    const balance = await refreshWalletBalance(wallet.address)
    if (mountedRef.current) {
      setWallet((prev) => ({ ...prev, balance }))
    }
  }, [wallet.connected, wallet.address])

  return {
    ...wallet,
    balanceFormatted: formatKaspa(wallet.balance),
    balanceRaw: wallet.balance,
    krc20Balances,
    kaswareDetected,
    kaswareVersion,
    networkName,
    detecting,
    error,
    connect,
    disconnect,
    refreshBalance,
  }
}
