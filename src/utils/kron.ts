/**
 * KRON Launch platform client (api.kron.technology).
 *
 * Standards layer: every on-chain KCC-20 token on KRON is created by the KRON
 * platform itself (their app holds the deploy builders). This module implements
 * the PUBLIC launchpad contract a pump.fun-style UI needs:
 *
 *   - tick availability   GET  /api/registry/tick?tick=
 *   - launch fee quote    GET  /api/launch-fee           (USD + sompi + fee policy)
 *   - image validation    GET  /api/registry/check-image?url=
 *   - import resolution   POST /api/import/resolve       (txid -> covid + params)
 *   - import registration POST /api/import/register      (txid + selfReported + covid)
 *   - registry listing    GET  /api/registry/tokens      (already-listed tokens)
 *   - registry external   GET  /api/registry/external
 *   - signed registration POST /api/registry/tokens      (KRON-REGISTER-1 manifest)
 *
 * Registration requires the wallet's KIP-5 `signMessage` (Kasware exposes it);
 * the manifest is the canonical JSON string `KRON-REGISTER-1` and must be signed
 * byte-for-byte. Signature flow mirrors the KRON app's own `recordToken`.
 */

export const KRON_API = "https://api.kron.technology"

export interface FeePolicy {
  enforced: boolean
  platformFeeOwner: string
  devFundOwner: string
  creatorFeeBps: number
  platformFeeBps: number
  devFundBps: number
  graduationFeeBps: number
  dexCreatorFeeBps: number
  dexPlatformFeeBps: number
  dexLpFeeBps: number
}

export interface LaunchFee {
  enabled: boolean
  usd: number
  sompi: string
  floorSompi?: string
  kasUsd?: number
  feePolicy?: FeePolicy
  templateSchema?: string
}

export interface TickCheck {
  tick?: string
  available?: boolean
  reason?: string
}

export interface ImageCheck {
  ok?: boolean
  reason?: string
}

export interface RegistryToken {
  tick: string
  name?: string
  description?: string
  image?: string
  creator?: string
  covid?: string
  txid?: string
  links?: { website?: string | null; x?: string | null; telegram?: string | null }
  selfReported?: { symbol?: string }
  [key: string]: unknown
}

export interface RegistryList {
  tokens: RegistryToken[]
}

export interface SelfReported {
  name?: string
  symbol?: string
  description?: string
  image?: string
  website?: string
  x?: string
  telegram?: string
}

/** Launch-fee sanity ceiling from the KRON app (`Cd = 500000000000`). */
export const LAUNCH_FEE_CAP_SOMPI = 500_000_000_000n

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${KRON_API}${path}`, { headers: { "content-type": "application/json" } })
  if (!res.ok) throw new Error(`KRON ${path} failed (${res.status})`)
  return (await res.json()) as T
}

/** GET /api/launch-fee — the live fee quote + enforced fee policy. */
export async function fetchLaunchFee(): Promise<LaunchFee | null> {
  try {
    const t = await getJson<LaunchFee>("/api/launch-fee")
    if (t?.sompi == null) return null
    const e = BigInt(t.sompi)
    if (e < 0n || e > LAUNCH_FEE_CAP_SOMPI) throw new Error(`launch fee ${e} sompi out of range`)
    return t
  } catch {
    return null
  }
}

/** GET /api/registry/tick?tick= — is this tick available to launch? */
export async function checkTickAvailable(tick: string): Promise<TickCheck | null> {
  try {
    return await getJson<TickCheck>(`/api/registry/tick?tick=${encodeURIComponent(String(tick).toLowerCase())}`)
  } catch {
    return null
  }
}

/** GET /api/registry/check-image?url= — sanity-check an image URL before launch. */
export async function checkImageUrl(url: string): Promise<ImageCheck | null> {
  try {
    return await getJson<ImageCheck>(`/api/registry/check-image?url=${encodeURIComponent(url)}`)
  } catch {
    return null
  }
}

/** GET /api/registry/tokens — tokens already listed on the launchpad. */
export async function listRegistryTokens(): Promise<RegistryToken[]> {
  const t = await getJson<RegistryList>("/api/registry/tokens")
  return t?.tokens ?? []
}

/** GET /api/registry/external — externally deployed tokens tracked by KRON. */
export async function listExternalTokens(): Promise<RegistryToken[]> {
  const t = await getJson<RegistryList>("/api/registry/external")
  return t?.tokens ?? []
}

/** POST /api/import/resolve — resolve an existing on-chain token txid into its covenant id + params. */
export async function resolveImport(txid: string): Promise<{ covid?: string; tick?: string; symbol?: string; params?: Record<string, unknown>; error?: string }> {
  const res = await fetch(`${KRON_API}/api/import/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txid }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error((body.error as string) ?? `resolve failed (${res.status})`)
  return body as { covid?: string; tick?: string; symbol?: string; params?: Record<string, unknown>; error?: string }
}

/** POST /api/import/register — register a resolved token with self-reported metadata. */
export async function registerImport(txid: string, selfReported: SelfReported, covid: string): Promise<RegistryToken> {
  const res = await fetch(`${KRON_API}/api/import/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txid, selfReported, covid }),
  })
  const body = (await res.json().catch(() => ({}))) as { token?: RegistryToken; error?: string }
  if (!res.ok) throw new Error(body.error ?? `import failed (${res.status})`)
  return body.token as RegistryToken
}

/* ---------------------------------------------------------------------------
 * Signed registration (KRON-REGISTER-1)
 * ------------------------------------------------------------------------- */

export interface RegisterRecord {
  tick: string
  txid?: string | null
  creator?: string | null
  tokenCovid?: string | null
  curveCovid?: string | null
  name?: string | null
  description?: string | null
  image?: string | null
  links?: { website?: string | null; x?: string | null; telegram?: string | null } | null
}

export interface SignatureResult {
  signature: string
  publicKey: string
}

/** The canonical KRON-REGISTER-1 message — sign this string byte-for-byte. */
export function canonicalRegMsg(rec: RegisterRecord): string {
  return JSON.stringify({
    v: "KRON-REGISTER-1",
    tick: String(rec.tick ?? "").toLowerCase(),
    txid: rec.txid ?? null,
    creator: rec.creator ?? null,
    tokenCovid: rec.tokenCovid ?? null,
    curveCovid: rec.curveCovid ?? null,
    name: rec.name ?? null,
    description: rec.description ?? null,
    image: rec.image ?? null,
    links: rec.links
      ? { website: rec.links.website ?? null, x: rec.links.x ?? null, telegram: rec.links.telegram ?? null }
      : null,
  })
}

/** POST /api/registry/tokens — write a signed registration record to the launchpad. */
export async function recordToken(rec: RegisterRecord, sign: SignatureResult): Promise<RegistryToken> {
  const res = await fetch(`${KRON_API}/api/registry/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rec, signature: sign.signature, publicKey: sign.publicKey }),
  })
  const body = (await res.json().catch(() => ({}))) as { token?: RegistryToken; error?: string }
  if (!res.ok) throw new Error(`registry write failed (${res.status}): ${body.error ?? ""}`)
  return body.token as RegistryToken
}

/** Sign a string with the connected wallet's KIP-5 `signMessage` (Kasware). */
export async function signMessageWithKasware(message: string): Promise<SignatureResult | null> {
  const w = (window as any)?.kasware
  if (!w?.signMessage) return null
  const signature = await w.signMessage(message)
  if (!signature) return null
  const publicKey = await w.getPublicKey?.()
  return { signature: String(signature), publicKey: String(publicKey) }
}
