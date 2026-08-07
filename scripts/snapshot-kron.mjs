// Refresh the static KRON integration snapshot (registry + compiled covenant templates).
// The KRON API is CORS-pinned to kron.technology, so browsers can't fetch it; this script
// snapshots the STATIC data (token registry + per-token compiled templates) into
// public/kron-snapshot.json, served to the app from the jsDelivr CDN (tag: kron-snapshot).
// Run: node scripts/snapshot-kron.mjs   (only static data — templates are deterministic)
import { writeFileSync, mkdirSync } from "node:fs"

const API = "https://api.kron.technology"
const RETRIES = 6
const GAP_MS = 1500
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

const fetchJSON = async (url, init, fatal = "response") => {
  for (let i = 0; i < RETRIES; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), "user-agent": UA } })
      if (r.ok) return await r.json()
      if (i === RETRIES - 1) throw new Error(`${fatal} HTTP ${r.status}`)
    } catch (e) {
      if (i === RETRIES - 1) throw e
    }
    await new Promise((res) => setTimeout(res, GAP_MS * (i + 1)))
  }
  throw new Error("fetch aborted")
}

const tl = await fetchJSON(`${API}/api/registry/tokenlist`)
const out = {
  kind: "kron-snapshot",
  network: "mainnet",
  generatedAt: new Date().toISOString(),
  version: tl.version,
  timestamp: tl.timestamp,
  registry: tl.tokens.map((t) => t), // verbatim — needed for decimals + curveParams (fees/vKas)
  compile: {},
}

for (const t of tl.tokens) {
  const key = t.symbol.toLowerCase()
  try {
    out.compile[key] = await fetchJSON(
      `${API}/api/native/cp-template`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...t.extensions.curveParams,
          tokenCovid: t.covenantId,
          templateVersion: t.extensions.templateVersion,
        }),
      },
      `cp-template ${key}`,
    ).then((body) => ({
      token: { scriptHex: body.token?.scriptHex ?? body.token?.script, stateStart: Number(body.token?.stateStart ?? 0) },
      pool: {
        scriptHex: body.pool?.scriptHex ?? body.pool?.script,
        stateStart: Number(body.pool?.stateStart ?? 0),
        canonicalLpInventory: body.pool?.canonicalLpInventory ?? body.canonicalLpInventory ?? true,
      },
      curve: { scriptHex: body.curve?.scriptHex ?? body.curve?.script, stateStart: Number(body.curve?.stateStart ?? 0) },
      params: body.params ?? body.pool?.params ?? {},
    }))
  } catch (e) {
    console.log(`compile failed: ${key} — ${e.message}`)
  }
  await new Promise((res) => setTimeout(res, GAP_MS))
}

mkdirSync("public", { recursive: true })
writeFileSync("public/kron-snapshot.json", JSON.stringify(out))
const failed = tl.tokens.filter((t) => !out.compile[t.symbol.toLowerCase()]).map((t) => t.symbol)
console.log(`compiled ${Object.keys(out.compile).length}/${tl.tokens.length} · failed: ${failed.join(", ") || "none"}`)
if (failed.length) process.exit(1)
