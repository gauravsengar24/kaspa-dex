"""Covenant swap lifecycle: create order, watch funding, claim, refund."""
import asyncio
import json
import os
import time
import uuid

from kaspa import Keypair

from backend.covenants import config
from backend.covenants.htlc import (
    CovenantRpcClient,
    build_funding_tx,
    build_htlc_tx,
    hashlock,
    htlc_redeem,
    p2sh_for,
    redeem_from_cfg,
)
from backend.covenants.store import CovenantStore

ORDER_STATES = ("created", "funded", "claimed", "refunded", "error")

WATCH_INTERVAL_SECONDS = 15
FUND_GRACE_SOMPI = config.MIN_OUT_SOMPI


class CovenantSwapEngine:
    def __init__(self, store: CovenantStore, network: str | None = None):
        self.store = store
        self.network = config.get_network(network)
        self._rpc: CovenantRpcClient | None = None

    @property
    def rpc(self) -> CovenantRpcClient:
        if self._rpc is None:
            self._rpc = CovenantRpcClient(self.network["label"])
        return self._rpc

    # ---------------- order creation ----------------

    async def create_order(
        self,
        maker_address: str,
        amount_kas: float,
        token_out: str = "USDT",
    ) -> dict:
        amount_sompi = int(round(amount_kas * config.SOMPI_PER_KAS))
        if amount_sompi <= 0:
            raise ValueError("amount must be positive")
        daa = await self.rpc.current_daa()
        timeout = daa + config.DEFAULT_TIMEOUT_DAA

        maker_kp = Keypair.random()
        taker_kp = Keypair.random()
        secret = os.urandom(32)
        H = hashlock(secret)
        redeem = htlc_redeem(
            H, timeout,
            bytes.fromhex(maker_kp.xonly_public_key),
            bytes.fromhex(taker_kp.xonly_public_key),
        )
        address, _spk = p2sh_for(redeem, self.network["address_net"])
        if not self.network["dex_address"]:
            raise ValueError(f"dex_address not configured for {self.network['label']}")

        order = {
            "id": str(uuid.uuid4()),
            "state": "created",
            "network": self.network["label"],
            "maker_address": maker_address,
            "maker_x": maker_kp.xonly_public_key,
            "maker_priv": maker_kp.private_key,
            "taker_x": taker_kp.xonly_public_key,
            "taker_priv": taker_kp.private_key,
            "secret": secret.hex(),
            "hash": H.hex(),
            "htlc_address": address,
            "amount_sompi": amount_sompi,
            "token_out": token_out.upper(),
            "usdt_amount": round(amount_kas * config.usdt_per_kas(), 8),
            "timeout_daa": timeout,
            "created_at": time.time(),
        }
        await self.store.create_order(order)
        return self.public_view(order)

    def public_view(self, order: dict) -> dict:
        return {
            "id": order["id"],
            "state": order["state"],
            "network": order["network"],
            "makerAddress": order["maker_address"],
            "htlcAddress": order["htlc_address"],
            "amountKas": order["amount_sompi"] / config.SOMPI_PER_KAS,
            "amountSompi": order["amount_sompi"],
            "tokenOut": order["token_out"],
            "usdtAmount": order["usdt_amount"],
            "secretHash": order["hash"],
            "makerPubkey": order["maker_x"],
            "takerPubkey": order["taker_x"],
            "timeoutDaa": order["timeout_daa"],
            "makerPrivateKey": order["maker_priv"],
            "explorer": self.network["explorer"],
        }

    async def get_order(self, order_id: str) -> dict | None:
        order = await self.store.get_order(order_id)
        if not order:
            return None
        return await self._enrich(order)

    async def list_orders(self, maker_address: str | None = None) -> list[dict]:
        orders = await self.store.list_orders()
        out = []
        for o in orders:
            if maker_address and o["maker_address"].lower() != maker_address.lower():
                continue
            out.append(await self._enrich(o))
        return out

    async def _enrich(self, order: dict) -> dict:
        view = self.public_view(order)
        daa = await self.rpc.current_daa()
        view["currentDaa"] = daa
        view["refundOpen"] = daa >= order["timeout_daa"]
        view["timeRemainingDaa"] = max(0, order["timeout_daa"] - daa)
        view["claimTxId"] = order.get("claim_tx_id")
        view["refundTxId"] = order.get("refund_tx_id")
        try:
            view["onChainBalance"] = await self.rpc.address_balance(order["htlc_address"]) / config.SOMPI_PER_KAS
        except Exception:
            view["onChainBalance"] = 0
        return view

    # ---------------- lifecycle actions ----------------

    async def refresh_funding(self, order: dict) -> str:
        """Return 'funded' if the HTLC address now holds the promised KAS."""
        if order["state"] not in ("created", "funded"):
            return order["state"]
        try:
            bal = await self.rpc.address_balance(order["htlc_address"])
        except Exception as e:
            return order["state"] or "error"
        if bal >= order["amount_sompi"]:
            if order["state"] != "funded":
                await self.store.update_order(order["id"], {"state": "funded", "funded_at": time.time()})
                order["state"] = "funded"
        return order["state"]

    async def claim_order(self, order_id: str) -> dict:
        order = await self.store.get_order(order_id)
        if not order:
            raise KeyError("order not found")
        state = await self.refresh_funding(order)
        if state != "funded":
            raise RuntimeError(f"order not funded (state={state})")
        entries = await self.rpc.utxo_entries(order["htlc_address"])
        if not entries:
            raise RuntimeError("no HTLC UTXOs found")
        total = sum(int(u.amount) for u in entries)
        if total < order["amount_sompi"]:
            raise RuntimeError(f"underfunded: {total} < {order['amount_sompi']} sompi")
        redeem = redeem_from_cfg(order)
        redeem_hex = redeem.hex()
        tx = build_htlc_tx(
            entries,
            self.network["dex_address"],
            redeem_hex,
            order["taker_priv"],
            path="claim",
            secret=bytes.fromhex(order["secret"]),
        )
        tx_id = await self.rpc.submit(tx)
        credited = await self.store.credit(
            order["maker_address"], order["token_out"], order["usdt_amount"]
        )
        await self.store.update_order(
            order["id"],
            {"state": "claimed", "claimed_at": time.time(), "claim_tx_id": tx_id, "error": None},
        )
        return {
            "orderId": order_id,
            "state": "claimed",
            "claimTxId": tx_id,
            "kasClaimed": total / config.SOMPI_PER_KAS,
            "tokenOut": order["token_out"],
            "usdtCredited": order["usdt_amount"],
            "creditBalance": credited,
            "explorer": self.network["explorer"],
        }

    async def refund_order(self, order_id: str, maker_priv: str | None = None) -> dict:
        order = await self.store.get_order(order_id)
        if not order:
            raise KeyError("order not found")
        daa = await self.rpc.current_daa()
        if daa < order["timeout_daa"]:
            raise RuntimeError(
                f"refund opens at DAA {order['timeout_daa']}, now {daa} "
                f"({order['timeout_daa'] - daa} DAA left)"
            )
        priv = maker_priv or order["maker_priv"]
        entries = await self.rpc.utxo_entries(order["htlc_address"])
        if not entries:
            raise RuntimeError("no HTLC UTXOs to refund")
        redeem = redeem_from_cfg(order)
        tx = build_htlc_tx(
            entries,
            order["maker_address"],
            redeem.hex(),
            priv,
            path="refund",
            lock_time=daa - config.LOCKTIME_MARGIN,
            sequence=1,
        )
        tx_id = await self.rpc.submit(tx)
        await self.store.update_order(
            order["id"],
            {"state": "refunded", "refund_tx_id": tx_id, "error": None},
        )
        return {
            "orderId": order_id,
            "state": "refunded",
            "refundTxId": tx_id,
            "explorer": self.network["explorer"],
        }

    # ---------------- background watcher ----------------

    async def watcher_loop(self):
        while True:
            try:
                for order in await self.store.orders_by_state(["created", "funded"]):
                    try:
                        state = await self.refresh_funding(order)
                        if state == "funded":
                            await self.claim_order(order["id"])
                    except Exception as e:
                        await self.store.update_order(order["id"], {"error": str(e)[:500]})
            except Exception:
                pass
            await asyncio.sleep(WATCH_INTERVAL_SECONDS)

    # ---------------- DEX-side funding (test / treasury ops) ----------------

    async def fund_htlc_from_dex(self, order_id: str, amount_kas: float, change_address: str | None = None) -> dict:
        """Move KAS from the DEX treasury into an HTLC address (used for testing)."""
        order = await self.store.get_order(order_id)
        if not order:
            raise KeyError("order not found")
        dex_addr = self.network["dex_address"]
        priv = self.network["dex_private_key"]
        if not priv:
            raise RuntimeError("dex_private_key not configured")
        entries = await self.rpc.utxo_entries(dex_addr)
        if not entries:
            raise RuntimeError("no DEX UTXOs")
        amount_sompi = int(round(amount_kas * config.SOMPI_PER_KAS))
        total = sum(int(u.amount) for u in entries)
        if amount_sompi + config.FEE_SOMPI > total:
            raise RuntimeError(f"DEX balance {total} too low for {amount_sompi}")
        # pick the fewest UTXOs (largest first) to keep transaction mass under the cap
        ordered = sorted(entries, key=lambda u: int(u.amount), reverse=True)
        picked, have = [], 0
        for u in ordered:
            picked.append(u)
            have += int(u.amount)
            if have >= amount_sompi + config.FEE_SOMPI:
                break
        tx = build_funding_tx(
            picked, order["htlc_address"], amount_sompi, change_address or dex_addr, priv
        )
        tx_id = await self.rpc.submit(tx)
        return {"orderId": order_id, "fundTxId": tx_id, "explorer": self.network["explorer"]}
