import { loadKaspa } from "./node_modules/@kronsdk/kron-sdk/dist/wasm/index.browser.js"

const CDN = "https://cdn.jsdelivr.net/gh/gauravsengar24/kaspa-dex@kaspa-wasm/vendor/kaspa_bg.wasm"
const ADDR = "kaspa:qpagqzgydc7ynkv9zegpjz0wac4vxvgurdjgx5egtfey964q6xenyplgj4lgr"

async function main() {
  const k = await loadKaspa(CDN)
  console.log("BROWSER-GLUE loaded")
  const spk = k.payToAddressScript(ADDR)
  console.log("spk ok, script len", spk.script.length)
  const covid = "f10e73d330a69fb3f5419036602b1d0bc5178fb54a1583f45f4e9167d324b50d"
  const h = new k.Hash(covid)
  console.log("Hash len", h.toString().length)
  const out = new k.TransactionOutput(BigInt(3783695000000), spk, new k.CovenantBinding(0, h))
  console.log("out isTO:", out instanceof k.TransactionOutput)
  try {
    const tx = new k.Transaction({
      version: 1, inputs: [], outputs: [out], lockTime: 0n, gas: 0n, payload: "",
      subnetworkId: "0000000000000000000000000000000000000000",
    })
    console.log("Transaction OK:", tx.serializeToSafeJSON().slice(0, 100))
  } catch (e) {
    console.log("Transaction FAILED:", e.message)
  }
}
main().catch((e) => console.error("TOP", e?.message ?? e))