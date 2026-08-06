"""HTLC covenant script + transaction construction, and a thin wRPC client.

Script layout (mirrors the on-chain proven reference implementation):
    OpIf
        OpBlake2b <H> OpEqualVerify          # hashlock: blake2b(preimage) == H
        <taker_xonly> OpCheckSig             # taker signature
    OpElse
        Op1 OpCheckSequenceVerify            # force non-final sequence
        OpTxLockTime <timeout> OpGreaterThanOrEqual OpVerify
        <maker_xonly> OpCheckSig             # maker signature
    OpEndIf

Claim witness  : [taker_sig, preimage, 1] + redeem
Refund witness : [maker_sig, 0]            + redeem
"""
import asyncio
import hashlib
import inspect
import os

import kaspa
from kaspa import (
    RpcClient,
    ScriptBuilder,
    PaymentOutput,
    Keypair,
    PrivateKey,
    SighashType,
    address_from_script_public_key,
    create_transaction,
    create_input_signature,
    pay_to_script_hash_signature_script,
    UtxoEntryReference,
)

from backend.covenants import config


def to_hex(x) -> str:
    if isinstance(x, str):
        return x
    if isinstance(x, (bytes, bytearray)):
        return bytes(x).hex()
    for m in ("to_string", "to_hex"):
        if hasattr(x, m):
            return getattr(x, m)()
    return str(x)


def to_bytes(x) -> bytes:
    return x if isinstance(x, (bytes, bytearray)) else bytes.fromhex(to_hex(x))


async def aw(x):
    return await x if inspect.isawaitable(x) else x


def push_num(n: int) -> bytes:
    if n == 0:
        return bytes([0x00])
    b = bytearray()
    while n:
        b.append(n & 0xFF)
        n >>= 8
    if b[-1] & 0x80:
        b.append(0x00)
    return bytes([len(b)]) + bytes(b)


def push_data(bs: bytes) -> bytes:
    n = len(bs)
    if n < 0x4C:
        return bytes([n]) + bs
    if n <= 0xFF:
        return bytes([0x4C, n]) + bs
    return bytes([0x4D]) + n.to_bytes(2, "little") + bs


def hashlock(secret: bytes) -> bytes:
    return hashlib.blake2b(secret, digest_size=32).digest()


def htlc_redeem(H: bytes, timeout: int, maker_x: bytes, taker_x: bytes) -> bytes:
    b = bytearray()
    b += bytes([0x63])  # OpIf (selector 1 = claim, 0 = refund)
    # --- CLAIM: blake2b(preimage) == H ; taker sig ---
    b += bytes([0xAA])  # OpBlake2b
    b += push_data(H)
    b += bytes([0x88])  # OpEqualVerify
    b += push_data(taker_x)
    b += bytes([0xAC])  # OpCheckSig
    b += bytes([0x67])  # OpElse
    # --- REFUND: lock_time >= timeout ; maker sig ---
    b += bytes([0x51, 0xB1])  # Op1 OpCheckSequenceVerify
    b += bytes([0xB5])  # OpTxLockTime
    b += push_num(timeout)
    b += bytes([0xA2, 0x69])  # OpGreaterThanOrEqual OpVerify
    b += push_data(maker_x)
    b += bytes([0xAC])  # OpCheckSig
    b += bytes([0x68])  # OpEndIf
    return bytes(b)


def p2sh_for(redeem_bytes: bytes, network: str) -> tuple[str, str]:
    """Return (address, p2sh_script_hex) for the redeem script."""
    sb = None
    for arg in (redeem_bytes.hex(), redeem_bytes):
        try:
            sb = ScriptBuilder.from_script(arg)
            break
        except Exception:
            continue
    if sb is None:
        raise ValueError("ScriptBuilder.from_script rejected hex and bytes")
    p2sh = sb.create_pay_to_script_hash_script()
    addr = None
    for net in (network, "testnet-10", "testnet"):
        try:
            addr = address_from_script_public_key(p2sh, net)
            break
        except Exception:
            continue
    if addr is None:
        raise ValueError(f"address_from_script_public_key failed for network {network}")
    return addr.to_string(), to_hex(p2sh.script)


def _sig_push(redeem_hex: str, sig: str) -> tuple[str, str]:
    """SDK signature encoding (correct sighash byte) minus the redeem push."""
    full = to_hex(pay_to_script_hash_signature_script(redeem_hex, sig))
    rpush = push_data(to_bytes(redeem_hex)).hex()
    if not full.endswith(rpush):
        raise ValueError("unexpected sig-script layout")
    return full[: -len(rpush)], rpush


def claim_sig_script(redeem_hex: str, sig: str, preimage: bytes) -> str:
    sig_push, rpush = _sig_push(redeem_hex, sig)
    return sig_push + push_data(preimage).hex() + "51" + rpush


def refund_sig_script(redeem_hex: str, sig: str) -> str:
    sig_push, rpush = _sig_push(redeem_hex, sig)
    return sig_push + "00" + rpush


def redeem_from_cfg(cfg: dict) -> bytes:
    return htlc_redeem(
        bytes.fromhex(cfg["hash"]),
        cfg.get("timeout_daa") or cfg["timeout"],
        bytes.fromhex(cfg["maker_x"]),
        bytes.fromhex(cfg["taker_x"]),
    )


def build_htlc_tx(
    entries: list,
    payout_address: str,
    redeem_hex: str,
    signer_priv: str,
    path: str,
    secret: bytes | None = None,
    lock_time: int = 0,
    sequence: int = 0,
) -> object:
    """Create + sign a claim or refund transaction spending all HTLC UTXOs."""
    total = sum(int(u.amount) for u in entries)
    out_amt = total - config.FEE_SOMPI
    if out_amt < config.MIN_OUT_SOMPI:
        raise ValueError(f"payout {out_amt} sompi below dust {config.MIN_OUT_SOMPI}")
    tx = create_transaction(entries, [PaymentOutput(payout_address, out_amt)], 0)
    if lock_time:
        tx.lock_time = lock_time
    for i in range(len(entries)):
        if sequence:
            tx.inputs[i].sequence = sequence
        sig = create_input_signature(tx, i, PrivateKey(signer_priv), SighashType.All)
        if path == "claim":
            tx.inputs[i].signature_script = claim_sig_script(redeem_hex, sig, secret)
        else:
            tx.inputs[i].signature_script = refund_sig_script(redeem_hex, sig)
    return tx


def build_funding_tx(
    entries: list,
    dest_address: str,
    total_out: int,
    change_address: str,
    signer_priv: str,
) -> object:
    """Plain (non-covenant) send used to fund an HTLC address."""
    outs = []
    if total_out > 0:
        outs.append(PaymentOutput(dest_address, total_out))
    change = sum(int(u.amount) for u in entries) - total_out - config.FEE_SOMPI
    if change > 0:
        outs.append(PaymentOutput(change_address, change))
    if not outs:
        raise ValueError("nothing to send")
    tx = create_transaction(entries, outs, 0)
    for i in range(len(entries)):
        # create_input_signature already returns the minimal push encoding
        # (length prefix + schnorr sig + sighash byte)
        tx.inputs[i].signature_script = create_input_signature(
            tx, i, PrivateKey(signer_priv), SighashType.All
        )
    return tx


class CovenantRpcClient:
    """Thin wRPC wrapper around the kaspa SDK RpcClient, with a REST fallback.

    The SDK talks wRPC to a node. Some deployments (HF Spaces, serverless) cannot
    reach a full node, so reads/broadcast transparently fall back to the public
    Kaspa REST API (api.kaspa.org / api-tn10.kaspa.org).
    """

    def __init__(self, network: str | None = None):
        net = config.get_network(network)
        self.network = net
        self._client: RpcClient | None = None
        self._rest = "https://api-tn10.kaspa.org" if net["label"] == "testnet-10" else "https://api.kaspa.org"
        self._rest = os.environ.get("KASPA_REST_URL", self._rest)
        self._rest_mode = False

    async def connect(self):
        if self._client is not None:
            return self._client
        try:
            enc = getattr(kaspa.Encoding, "Borsh", None)
            c = RpcClient(url=self.network["rpc_url"], encoding=enc) if enc else RpcClient(url=self.network["rpc_url"])
            await asyncio.wait_for(aw(c.connect()), timeout=8)
            self._client = c
            return c
        except Exception:
            self._rest_mode = True
            return None

    async def close(self):
        if self._client is not None:
            try:
                await aw(self._client.disconnect())
            except Exception:
                pass
            self._client = None
            self._rest_mode = False

    # ---------- REST helpers ----------

    async def _rest_get(self, path: str) -> dict | list | None:
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{self._rest}{path}")
            if resp.status_code == 200:
                return resp.json()
        return None

    async def _rest_post(self, path: str, payload: dict) -> dict | None:
        import httpx
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{self._rest}{path}", json=payload)
            if resp.status_code in (200, 201):
                return resp.json()
        return None

    @staticmethod
    def _wire_json(tx) -> dict:
        """Raw transaction JSON accepted by the Kaspa REST API
        (api.kaspa.org / api-tn10.kaspa.org use a bespoke schema:
        outputs carry `amount`, scriptPublicKey is nested, inputs carry sigOpCount)."""
        return {
            "version": tx.version,
            "inputs": [
                {
                    "previousOutpoint": {
                        "transactionId": i.previous_outpoint.transaction_id,
                        "index": i.previous_outpoint.index,
                    },
                    "signatureScript": i.signature_script_as_hex,
                    "sequence": i.sequence,
                    "sigOpCount": i.sig_op_count,
                }
                for i in tx.inputs
            ],
            "outputs": [
                {
                    "amount": o.value,
                    "scriptPublicKey": {"version": 0, "scriptPublicKey": str(o.script_public_key)},
                }
                for o in tx.outputs
            ],
            "lockTime": tx.lock_time,
        }

    async def current_daa(self) -> int:
        try:
            c = await self.connect()
            if c is not None:
                return int((await aw(c.get_block_dag_info()))["virtualDaaScore"])
        except Exception:
            pass
        data = await self._rest_get("/info/blockdag")
        if not data:
            raise RuntimeError("node unreachable (wRPC and REST)")
        return int(data.get("virtualDaaScore", 0))

    async def utxos(self, address: str) -> list:
        try:
            c = await self.connect()
            if c is not None:
                r = await aw(c.get_utxos_by_addresses({"addresses": [address]}))
                return r.get("entries", r) if isinstance(r, dict) else r
        except Exception:
            pass
        data = await self._rest_get(f"/addresses/{address}/utxos")
        return data if isinstance(data, list) else []

    async def utxo_entries(self, address: str) -> list:
        raw = await self.utxos(address)
        entries = []
        for u in raw:
            u = dict(u)
            # REST returns string amounts / nested scriptPublicKey; normalize
            entry = u.get("utxoEntry") or u.get("entry") or u
            try:
                entry["amount"] = int(entry.get("amount", 0))
                entry["blockDaaScore"] = int(entry.get("blockDaaScore", 0))
                entry["isCoinbase"] = str(entry.get("isCoinbase", "false")).lower() == "true"
            except (TypeError, ValueError):
                continue
            entry.setdefault("covenantId", None)
            if "scriptPublicKey" in entry and isinstance(entry["scriptPublicKey"], dict):
                spk = entry["scriptPublicKey"].get("scriptPublicKey") or entry["scriptPublicKey"].get("script")
                if spk:
                    entry["scriptPublicKey"] = {"version": 0, "script": spk}
            u["utxoEntry"] = entry
            try:
                entries.append(UtxoEntryReference.from_dict(u))
            except Exception:
                continue
        return entries

    async def address_balance(self, address: str) -> int:
        return sum(int(u.amount) for u in await self.utxo_entries(address))

    async def submit(self, tx) -> str:
        if not self._rest_mode:
            try:
                c = await self.connect()
                if c is not None:
                    r = await aw(c.submit_transaction({"transaction": tx, "allowOrphan": False}))
                    if isinstance(r, dict):
                        txid = r.get("transactionId")
                        if txid:
                            return txid
                        err = r.get("error")
                        if err:
                            raise RuntimeError(f"node rejected: {err}")
                    elif isinstance(r, str) and r:
                        return r
                    raise RuntimeError(f"unexpected submit response: {r!r}")
            except RuntimeError as e:
                raise
            except Exception:
                self._rest_mode = True
        wire = self._wire_json(tx)
        for payload in (
            {"transaction": wire},
            {"jsonrpc": "2.0", "id": 1, "method": "submitTransaction", "params": {"transaction": wire}},
        ):
            try:
                r = await self._rest_post("/transactions", payload)
            except Exception:
                continue
            if not r:
                continue
            txid = (
                (r.get("result") or {}).get("transactionId")
                or (r.get("result") or {}).get("txid")
                or r.get("transactionId")
                or r.get("txid")
            )
            if txid:
                return txid
            err = (r.get("result") or {}).get("error") or r.get("error")
            if err:
                raise RuntimeError(f"node rejected: {err}")
        raise RuntimeError("broadcast failed (no response from node)")

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *exc):
        await self.close()
