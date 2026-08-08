import { loadKaspa } from "@kronsdk/kron-sdk/wasm"

const CDN = "https://cdn.jsdelivr.net/gh/gauravsengar24/kaspa-dex@kaspa-wasm/vendor/kaspa_bg.wasm"

async function main() {
  const k = await loadKaspa(CDN)
  console.log("kaspa loaded, Hash:", typeof k.Hash, "Transaction:", typeof k.Transaction)

  const covidHex = "f106f73dba74a69fb3f5419mma662b1f655179b54a1583f45f4e9167d324b50"
  const covid1 = "a73cdef004099b191759d320deei9451be0e1e2423a7sb15b07d5e51d155b47cd"
  const spk = k.payToScriptHashScript(k.XOnlyPublicKey(new Uint8Array(32)).toAddress())
  console.log("spk:", spk.toString())
  const outs = [
    new k.TransactionOutput(BigInt("3783697000000"), spk, new k.CovenantBinding(0, new k.Hash(covid0))),
    new k.TransactionOutput(BigInt("50000000"), spk, new k.CovenantBinding(1, new k.Hash(covid1))),
    new k.TransactionOutput(BigInt("50000000"), spk, new k.CovenantBinding(1, new k.Hash(covid1))),
  ]
  for (const [idx, o] of outs.entries()) console.log(`out${idx} instanceTO`, o instanceof k.TransactionOutput)
  try {
    const tx = new k.Transaction({
      version: 1,
      inputs: [],
      outputs: outs,
      lockTime: 0n,
      gas: 0n,
      payload: "",
      subnetworkId: "0000000000000000000000000000000000000000",
    })
    console.log("Transaction OK:", tx.serializeToSafeJSON())
  } catch (e) {
    console.log("Transaction FAILED:", e.message)
  }
}
main().catch((e) => console.error("TOP", e))