import { useState, useCallback, useEffect, useRef } from "react"
import type { OrderbookEntry } from "../types"
import { NETWORK } from "../utils/constants"

export function useOrderbook(pair: string) {
  const [orders, setOrders] = useState<OrderbookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`${NETWORK.backend}/api/orderbook/${pair}`)
      if (res.ok) {
        const data = await res.json()
        setOrders(data)
      }
    } catch {
      // fallback
    } finally {
      setLoading(false)
    }
  }, [pair])

  useEffect(() => {
    fetchOrders()
    const interval = setInterval(fetchOrders, 10000)
    return () => clearInterval(interval)
  }, [fetchOrders])

  const submitOrder = useCallback(async (order: Omit<OrderbookEntry, "id" | "timestamp" | "status">) => {
    const res = await fetch(`${NETWORK.backend}/api/orderbook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    })
    if (!res.ok) throw new Error("Failed to submit order")
    await fetchOrders()
    return res.json()
  }, [fetchOrders])

  const cancelOrder = useCallback(async (id: string) => {
    const res = await fetch(`${NETWORK.backend}/api/orderbook/${id}`, {
      method: "DELETE",
    })
    if (!res.ok) throw new Error("Failed to cancel order")
    await fetchOrders()
  }, [fetchOrders])

  return { orders, loading, submitOrder, cancelOrder, refresh: fetchOrders }
}
