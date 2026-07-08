import { useState, useCallback, useEffect, useRef } from "react"
import type { WalletState } from "../types"
import {
  connectWallet,
  disconnectWallet,
  refreshWalletBalance,
  onAccountsChanged,
  onNetworkChanged,
  ensureProvider,
  waitForProvider,
  getKasWareVersion,
  getKRC20Balances,
  formatKaspa,
  loadSession,
  clearSession,
  tryRestoreProvider,
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
      const tokens = await getKRC20Balances()
      if (mountedRef.current) {
        const map: Record<string, number> = {}
        for (const t of tokens) {
          map[t.tick] = Number(t.balance) / Math.pow(10, Number(t.dec || 8))
        }
        setKrc20Balances(map)
      }
    }

    const restoreSession = async () => {
      const saved = loadSession()
      if (!saved) return null

      const p = await tryRestoreProvider()
      if (cancelled || !p) return saved

      try {
        const accounts = await p.getAccounts()
        if (accounts && accounts.length > 0 && accounts[0] === saved.address) {
          const balanceData = await p.getBalance()
          const balance = balanceData?.total ? Number(balanceData.total) / 100_000_000 : 0
          if (mountedRef.current) {
            setWallet({ address: accounts[0], balance, connected: true, connecting: false })
          }
          await fetchKrc20()
          return null
        }
      } catch { /* ignore */ }

      return saved
    }

    const init = async () => {
      const saved = await restoreSession()
      if (cancelled) return

      const found = await waitForProvider(4000)
      if (cancelled) return

      if (mountedRef.current) setKaswareDetected(found)

      if (found) {
        const ver = getKasWareVersion()
        if (mountedRef.current) setKaswareVersion(ver)

        if (!saved) {
          try {
            const p = await ensureProvider()
            const accounts = await p.getAccounts()
            if (accounts && accounts.length > 0 && mountedRef.current) {
              const balance = await refreshWalletBalance(accounts[0])
              if (mountedRef.current) {
                setWallet({ address: accounts[0], balance, connected: true, connecting: false })
              }
              await fetchKrc20()
            }
          } catch { /* not connected */ }
        }
      }

      if (cancelled) return
      if (mountedRef.current) setDetecting(false)
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
