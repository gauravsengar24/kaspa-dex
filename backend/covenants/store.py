"""SQLite persistence for covenant swap orders + off-chain token credits."""
import json
import os
import time
import uuid
from typing import Any, Optional

import aiosqlite

DB_PATH = "data/covenant.db"


class CovenantStore:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    async def init(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        self._db = await aiosqlite.connect(self.db_path)
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute(
            """CREATE TABLE IF NOT EXISTS covenant_orders (
                id TEXT PRIMARY KEY,
                state TEXT NOT NULL DEFAULT 'created',
                network TEXT NOT NULL,
                maker_address TEXT NOT NULL,
                maker_x TEXT NOT NULL,
                maker_priv TEXT NOT NULL,
                taker_x TEXT NOT NULL,
                taker_priv TEXT NOT NULL,
                secret TEXT NOT NULL,
                hash TEXT NOT NULL,
                htlc_address TEXT NOT NULL,
                amount_sompi INTEGER NOT NULL,
                token_out TEXT NOT NULL,
                usdt_amount REAL NOT NULL,
                timeout_daa INTEGER NOT NULL,
                created_at REAL NOT NULL,
                funded_at REAL,
                claimed_at REAL,
                claim_tx_id TEXT,
                refund_tx_id TEXT,
                error TEXT
            )"""
        )
        await self._db.execute(
            """CREATE TABLE IF NOT EXISTS token_credits (
                address TEXT NOT NULL,
                ticker TEXT NOT NULL,
                amount REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (address, ticker)
            )"""
        )
        await self._db.commit()

    async def close(self):
        if self._db:
            await self._db.close()
            self._db = None

    # ---------- orders ----------

    async def create_order(self, order: dict) -> dict:
        await self._db.execute(
            """INSERT INTO covenant_orders (
                id, state, network, maker_address, maker_x, maker_priv,
                taker_x, taker_priv, secret, hash, htlc_address, amount_sompi,
                token_out, usdt_amount, timeout_daa, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                order["id"], order["state"], order["network"], order["maker_address"],
                order["maker_x"], order["maker_priv"], order["taker_x"], order["taker_priv"],
                order["secret"], order["hash"], order["htlc_address"], order["amount_sompi"],
                order["token_out"], order["usdt_amount"], order["timeout_daa"], order["created_at"],
            ),
        )
        await self._db.commit()
        return order

    async def get_order(self, order_id: str) -> Optional[dict]:
        cur = await self._db.execute(
            "SELECT * FROM covenant_orders WHERE id = ?", (order_id,)
        )
        row = await cur.fetchone()
        return self._row_to_order(row)

    async def list_orders(self, state: Optional[str] = None) -> list[dict]:
        if state:
            cur = await self._db.execute(
                "SELECT * FROM covenant_orders WHERE state = ? ORDER BY created_at DESC",
                (state,),
            )
        else:
            cur = await self._db.execute(
                "SELECT * FROM covenant_orders ORDER BY created_at DESC"
            )
        rows = await cur.fetchall()
        return [o for o in (self._row_to_order(r) for r in rows) if o]

    async def orders_by_state(self, states: list[str]) -> list[dict]:
        marks = ",".join("?" * len(states))
        cur = await self._db.execute(
            f"SELECT * FROM covenant_orders WHERE state IN ({marks})",
            states,
        )
        rows = await cur.fetchall()
        return [o for o in (self._row_to_order(r) for r in rows) if o]

    async def update_order(self, order_id: str, fields: dict) -> bool:
        if not fields:
            return False
        cols = ", ".join(f"{k} = ?" for k in fields)
        await self._db.execute(
            f"UPDATE covenant_orders SET {cols} WHERE id = ?",
            (*fields.values(), order_id),
        )
        await self._db.commit()
        return True

    @staticmethod
    def _row_to_order(row) -> Optional[dict]:
        if row is None:
            return None
        cols = [
            "id", "state", "network", "maker_address", "maker_x", "maker_priv",
            "taker_x", "taker_priv", "secret", "hash", "htlc_address", "amount_sompi",
            "token_out", "usdt_amount", "timeout_daa", "created_at", "funded_at",
            "claimed_at", "claim_tx_id", "refund_tx_id", "error",
        ]
        return {c: v for c, v in zip(cols, row)}

    # ---------- token credits ----------

    async def get_credits(self, address: str) -> dict[str, float]:
        cur = await self._db.execute(
            "SELECT ticker, amount FROM token_credits WHERE address = ? AND amount > 0",
            (address,),
        )
        rows = await cur.fetchall()
        return {t: a for t, a in rows}

    async def credit(self, address: str, ticker: str, amount: float) -> float:
        ticker = ticker.upper()
        await self._db.execute(
            """INSERT INTO token_credits (address, ticker, amount) VALUES (?,?,?)
               ON CONFLICT(address, ticker) DO UPDATE SET amount = amount + excluded.amount""",
            (address, ticker, amount),
        )
        await self._db.commit()
        cur = await self._db.execute(
            "SELECT amount FROM token_credits WHERE address = ? AND ticker = ?",
            (address, ticker),
        )
        row = await cur.fetchone()
        return row[0] if row else 0.0
