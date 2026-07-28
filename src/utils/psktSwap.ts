const SOMPI_PER_KAS = 100_000_000

export interface PsktSwapTerms {
  makerAddress: string
  makerAmount: number
  makerToken: string
  takerAddress: string
  takerAmount: number
  takerToken: string
}

export interface PsktResult {
  psktHex: string
  txId?: string
}

export async function buildMakerPskt(terms: PsktSwapTerms): Promise<PsktResult> {
  const provider = ensureKasWare()
  const makerAddr = terms.makerAddress
  const takerAddr = terms.takerAddress
  const makerPaySompi = Math.floor(terms.makerAmount * SOMPI_PER_KAS)

  const utxos = await provider.getUtxoEntries(makerAddr)
  if (!utxos || utxos.length === 0) {
    throw new Error("No UTXOs available to fund the swap")
  }

  const selected = selectUtxos(utxos, makerPaySompi + 10000)
  if (!selected) {
    throw new Error("Insufficient funds for swap + fees")
  }

  const pskt = {
    inputs: selected.utxos.map((u: any) => ({
      transactionId: u.outpoint?.transactionId || u.transactionId,
      index: u.outpoint?.index || u.index,
      amount: u.entry?.amount || u.amount || 0,
      address: makerAddr,
      scriptPublicKey: u.entry?.scriptPublicKey || u.scriptPublicKey,
    })),
    outputs: [
      { address: takerAddr, amount: makerPaySompi },
    ],
    changeAddress: makerAddr,
    priorityFee: 1000,
  }

  return { psktHex: JSON.stringify(pskt) }
}

function selectUtxos(utxos: any[], targetAmount: number): { utxos: any[]; change: number } | null {
  const sorted = [...utxos].sort((a, b) => {
    const amtA = Number(a.entry?.amount || a.amount || 0)
    const amtB = Number(b.entry?.amount || b.amount || 0)
    return amtB - amtA
  })

  let selected: any[] = []
  let total = 0

  for (const utxo of sorted) {
    const amt = Number(utxo.entry?.amount || utxo.amount || 0)
    selected.push(utxo)
    total += amt
    if (total >= targetAmount) break
  }

  if (total < targetAmount) return null
  return { utxos: selected, change: total - targetAmount }
}

export async function signMakerPskt(psktHex: string): Promise<PsktResult> {
  const provider = ensureKasWare()
  const signedHex = await provider.signPskt(psktHex)
  return { psktHex: signedHex }
}

export async function signTakerPskt(psktHex: string, takerAddress: string): Promise<PsktResult> {
  const provider = ensureKasWare()
  const signedHex = await provider.signPskt(psktHex)
  return { psktHex: signedHex }
}

function ensureKasWare(): any {
  const p = (window as any).kasware
  if (!p) throw new Error("KasWare wallet not detected")
  return p
}

export async function pushTransaction(psktHex: string): Promise<string> {
  const provider = ensureKasWare()
  const txId = await provider.pushTx(psktHex)
  return txId
}

export function formatSompi(sompi: number | bigint): number {
  return Number(sompi) / SOMPI_PER_KAS
}
