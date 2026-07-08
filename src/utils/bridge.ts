import type { BridgeTransfer, BridgeConfig } from "../types"

export const KASPLEX_BRIDGE_CONFIG: BridgeConfig = {
  kurveBridge: "0x34606E6d01280f49791628B311cF33A808d1f7C6",
  katBridge: "0x699e7f4a64f6A5a1d7E26B05806d948338E7aDC2",
  wkas: "0xC065C62a10fB363fD31CA394D632C4Df106566df",
  chainId: 167012,
  rpcUrl: "https://rpc.kasplextest.xyz",
  explorerUrl: "https://explorer.testnet.kasplextest.xyz",
  minDeposit: 1,
  bridgeAdapter: "0x0B8A06fa0007B9e153a6F93982AB467d05bad445",
}

export const KASPLEX_MAINNET_CONFIG: BridgeConfig = {
  kurveBridge: "0x34606E6d01280f49791628B311cF33A808d1f7C6",
  katBridge: "0x699e7f4a64f6A5a1d7E26B05806d948338E7aDC2",
  wkas: "0x2c2Ae87Ba178F48637acAe54B87c3924F544a83e",
  chainId: 202555,
  rpcUrl: "https://evmrpc.kasplex.org",
  explorerUrl: "https://explorer.kasplex.org",
  minDeposit: 1,
}

export async function bridgeKAS(
  amount: string,
  kaspaAddress: string,
  config: BridgeConfig = KASPLEX_BRIDGE_CONFIG,
): Promise<BridgeTransfer> {
  const transfer: BridgeTransfer = {
    id: crypto.randomUUID(),
    direction: "deposit",
    token: "KAS",
    amount,
    kaspaAddress,
    status: "pending",
    timestamp: Date.now(),
  }

  try {
    const provider = (window as any).kasware?.ethereum || (window as any).ethereum
    if (!provider) throw new Error("No Web3 provider found")

    const tx = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        to: config.kurveBridge,
        value: `0x${(BigInt(Math.floor(Number(amount) * 1e18))).toString(16)}`,
        data: encodeBridgePayload(kaspaAddress),
      }],
    })

    return { ...transfer, txHash: tx, status: "confirmed" }
  } catch {
    return { ...transfer, status: "failed" }
  }
}

function encodeBridgePayload(kaspaAddress: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(kaspaAddress)
  return "0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function getBridgeHistory(): Promise<BridgeTransfer[]> {
  try {
    const stored = localStorage.getItem("kaspadex_bridge_history")
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}
