"""Offline unit tests for the HTLC covenant engine (no node required)."""
import sys
import os
import tempfile
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import pytest

from backend.covenants.htlc import (
    htlc_redeem,
    hashlock,
    push_data,
    push_num,
    p2sh_for,
    claim_sig_script,
    refund_sig_script,
    redeem_from_cfg,
    build_htlc_tx,
    build_funding_tx,
)
from backend.covenants.config import DEFAULT_TIMEOUT_DAA, SOMPI_PER_KAS
from backend.covenants.store import CovenantStore


# ---------------- script construction ----------------

def test_htlc_redeem_structure():
    H = bytes(32)
    redeem = htlc_redeem(H, 500, bytes.fromhex("ab" * 32), bytes.fromhex("cd" * 32))
    # OpIf at start, OpEndIf at end
    assert redeem[0] == 0x63
    assert redeem[-1] == 0x68
    # contains OpBlake2b and hash H
    assert 0xAA in redeem
    assert H in redeem
    # contains both x-only pubkeys
    assert bytes.fromhex("ab" * 32) in redeem
    assert bytes.fromhex("cd" * 32) in redeem
    # contains the timeout push (500 = 0x01f4, little endian 2 bytes)
    assert bytes.fromhex("f401") in redeem


def test_p2sh_address_derivation():
    secret = b"top-secret-preimage"
    H = hashlock(secret)
    redeem = htlc_redeem(H, 1234, bytes.fromhex("11" * 32), bytes.fromhex("22" * 32))
    addr, spk = p2sh_for(redeem, "testnet-10")
    assert addr.startswith("kaspatest:p")
    # local P2SH check: 0xaa20 <blake2b(redeem)> 0x87
    import hashlib
    expected_tail = "aa20" + hashlib.blake2b(redeem, digest_size=32).hexdigest() + "87"
    assert spk.endswith(expected_tail)


def test_push_helpers():
    assert push_num(0) == bytes([0x00])
    assert push_num(500) == bytes.fromhex("02f401")
    assert push_data(b"abc") == bytes.fromhex("03616263")
    assert push_data(b"x" * 80) == bytes.fromhex("4c50") + b"x" * 80


def test_sig_scripts_layout():
    H = bytes(32)
    redeem = htlc_redeem(H, 500, bytes.fromhex("ab" * 32), bytes.fromhex("cd" * 32))
    rhex = redeem.hex()
    claim = claim_sig_script(rhex, "41" + "ee" * 65, b"preimage!")
    assert claim.endswith(push_data(redeem).hex())
    # witness order: [sig, preimage, selector=1]
    assert "51" in claim
    refund = refund_sig_script(rhex, "41" + "ee" * 65)
    assert refund.endswith(push_data(redeem).hex())
    assert "00" in refund


def test_redeem_roundtrip_from_cfg():
    secret = os.urandom(32)
    H = hashlock(secret)
    cfg = {
        "hash": H.hex(),
        "timeout": 777,
        "maker_x": "ab" * 32,
        "taker_x": "cd" * 32,
    }
    redeem = redeem_from_cfg(cfg)
    assert htlc_redeem(H, 777, bytes.fromhex("ab" * 32), bytes.fromhex("cd" * 32)) == redeem


# ---------------- transaction building ----------------

def _make_entry(addr, spk, amount, txid):
    from kaspa import UtxoEntryReference
    return UtxoEntryReference.from_dict({
        "address": addr,
        "outpoint": {"transactionId": txid, "index": 0},
        "amount": amount,
        "scriptPublicKey": spk,
        "blockDaaScore": 0,
        "isCoinbase": False,
        "covenantId": None,
    })


def test_build_htlc_claim_tx():
    secret = os.urandom(32)
    H = hashlock(secret)
    redeem = htlc_redeem(H, 500, bytes.fromhex("ab" * 32), bytes.fromhex("cd" * 32))
    addr, spk = p2sh_for(redeem, "testnet-10")
    entries = [
        _make_entry(addr, spk, 100_000_000, "1" * 64),
        _make_entry(addr, spk, 50_000_000, "2" * 64),
    ]
    tx = build_htlc_tx(
        entries, "kaspatest:qrlc9t0mncjgm6t5hcdrz7fjzz678tkh3dcekagf2s7wkxssx0gu5rkjj564z",
        redeem.hex(), "cd" * 32, path="claim", secret=secret,
    )
    assert len(tx.inputs) == 2
    assert tx.outputs[0].value == 149_000_000
    for i in range(2):
        sig_script = bytes.fromhex(tx.inputs[i].signature_script_as_hex)
        # signature script must embed the redeem script (P2SH) and selector 0x51
        assert redeem in sig_script
        # contains the revealed preimage
        assert secret in sig_script


def test_build_htlc_refund_tx():
    H = bytes(32)
    redeem = htlc_redeem(H, 500, bytes.fromhex("ab" * 32), bytes.fromhex("cd" * 32))
    addr, spk = p2sh_for(redeem, "testnet-10")
    entries = [_make_entry(addr, spk, 100_000_000, "3" * 64)]
    tx = build_htlc_tx(
        entries, "kaspatest:qrlc9t0mncjgm6t5hcdrz7fjzz678tkh3dcekagf2s7wkxssx0gu5rkjj564z",
        redeem.hex(), "ab" * 32, path="refund",
        lock_time=1_000_000, sequence=1,
    )
    assert tx.lock_time == 1_000_000
    assert tx.inputs[0].sequence == 1
    sig_script = bytes.fromhex(tx.inputs[0].signature_script_as_hex)
    assert redeem in sig_script
    # selector 0 (refund branch)
    assert b"\x00" in sig_script[:-len(redeem)]
    # preimage must NOT be present
    assert b"secret" not in sig_script


def test_build_funding_tx():
    from kaspa import Keypair
    kp = Keypair.random()
    DEX_ADDR = "kaspatest:qrlc9t0mncjgm6t5hcdrz7fjzz678tkh3dcekagf2s7wkxssx0gu5rkjj564z"
    spk = "20" + bytes.fromhex(kp.xonly_public_key).hex() + "ac"
    entries = [
        _make_entry(DEX_ADDR, spk, 200_000_000, "4" * 64),
        _make_entry(DEX_ADDR, spk, 300_000_000, "5" * 64),
    ]
    tx = build_funding_tx(
        entries, DEX_ADDR,
        150_000_000, DEX_ADDR, kp.private_key,
    )
    assert len(tx.inputs) == 2
    assert len(tx.outputs) == 2
    assert tx.outputs[0].value == 150_000_000
    assert tx.outputs[1].value == 349_000_000
    for i in range(2):
        sig_script = bytes.fromhex(tx.inputs[i].signature_script_as_hex)
        # P2PKH-style single push with 65-byte schnorr sig + sighash
        assert sig_script[0] == 0x41
        assert sig_script[-1] == 0x01


# ---------------- store ----------------

@pytest.mark.asyncio
async def test_store_order_crud(tmp_path):
    store = CovenantStore(str(tmp_path / "t.db"))
    await store.init()
    try:
        order = {
            "id": "o1", "state": "created", "network": "testnet-10",
            "maker_address": "kaspatest:a", "maker_x": "ab" * 32,
            "maker_priv": "aa" * 32, "taker_x": "cd" * 32,
            "taker_priv": "cc" * 32, "secret": "ff" * 32, "hash": "ee" * 32,
            "htlc_address": "kaspatest:htlc", "amount_sompi": 5 * SOMPI_PER_KAS,
            "token_out": "USDT", "usdt_amount": 0.75, "timeout_daa": 1000,
            "created_at": 1.0,
        }
        await store.create_order(order)
        got = await store.get_order("o1")
        assert got["id"] == "o1"
        assert got["amount_sompi"] == 5 * SOMPI_PER_KAS
        await store.update_order("o1", {"state": "funded", "funded_at": 2.0})
        got = await store.get_order("o1")
        assert got["state"] == "funded"
        funded = await store.orders_by_state(["created", "funded"])
        assert len(funded) == 1
        await store.credit("kaspatest:u", "USDT", 1.5)
        await store.credit("kaspatest:u", "USDT", 0.5)
        assert await store.get_credits("kaspatest:u") == {"USDT": 2.0}
    finally:
        await store.close()


@pytest.mark.asyncio
async def test_engine_create_order(tmp_path):
    from backend.covenants.engine import CovenantSwapEngine

    # patch rpc to avoid any network access
    class FakeRpc:
        async def current_daa(self):
            return 42_000_000

    store = CovenantStore(str(tmp_path / "e.db"))
    await store.init()
    try:
        engine = CovenantSwapEngine(store, network="testnet-10")
        engine._rpc = FakeRpc()  # type: ignore
        view = await engine.create_order("kaspatest:maker", 5.0, "USDT")
        assert view["state"] == "created"
        assert view["htlcAddress"].startswith("kaspatest:p")
        assert view["amountKas"] == 5.0
        assert view["timeoutDaa"] == 42_000_000 + DEFAULT_TIMEOUT_DAA
        assert len(view["secretHash"]) == 64
        assert len(view["makerPrivateKey"]) == 64
        orders = await engine.list_orders()
        assert len(orders) == 1
        assert orders[0]["currentDaa"] == 42_000_000
        assert orders[0]["refundOpen"] is False
    finally:
        await store.close()
