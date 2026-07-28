import json
import time
import uuid
import os
from typing import Optional

from backend.models import OrderCreate, OrderResponse

DATA_DIR = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "orderbook.db")
USE_SQLITE = False

try:
    import aiosqlite
    USE_SQLITE = True
except ImportError:
    pass


class Orderbook:
    def __init__(self):
        self.orders: dict[str, dict] = {}
        if not USE_SQLITE:
            self._load_json()

    def _json_path(self):
        return os.path.join(DATA_DIR, "orderbook_data.json")

    def _load_json(self):
        path = self._json_path()
        if os.path.exists(path):
            try:
                data = json.loads(open(path).read())
                self.orders = {o["id"]: o for o in data}
            except (json.JSONDecodeError, KeyError):
                self.orders = {}

    def _save_json(self):
        path = self._json_path()
        with open(path, "w") as f:
            json.dump(list(self.orders.values()), f, indent=2)

    async def _init_db(self):
        if not USE_SQLITE:
            return
        os.makedirs(DATA_DIR, exist_ok=True)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY,
                    makerAddress TEXT NOT NULL,
                    makerAmount REAL NOT NULL,
                    makerToken TEXT NOT NULL,
                    takerAmount REAL NOT NULL,
                    takerToken TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open'
                )
            """)
            await db.commit()

    async def _load_db(self):
        if not USE_SQLITE:
            return
        await self._init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT * FROM orders")
            rows = await cursor.fetchall()
            self.orders = {}
            for row in rows:
                self.orders[row["id"]] = dict(row)

    async def _save_order_db(self, entry: dict):
        if not USE_SQLITE:
            return
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT OR REPLACE INTO orders
                   (id, makerAddress, makerAmount, makerToken, takerAmount, takerToken, timestamp, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (entry["id"], entry["makerAddress"], entry["makerAmount"],
                 entry["makerToken"], entry["takerAmount"], entry["takerToken"],
                 entry["timestamp"], entry["status"])
            )
            await db.commit()

    async def _update_status_db(self, oid: str, status: str):
        if not USE_SQLITE:
            return
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("UPDATE orders SET status = ? WHERE id = ?", (status, oid))
            await db.commit()

    async def initialize(self):
        if USE_SQLITE:
            await self._load_db()
        else:
            self._load_json()

    def submit(self, order: OrderCreate) -> OrderResponse:
        oid = str(uuid.uuid4())
        entry = {
            "id": oid,
            "makerAddress": order.makerAddress,
            "makerAmount": order.makerAmount,
            "makerToken": order.makerToken,
            "takerAmount": order.takerAmount,
            "takerToken": order.takerToken,
            "timestamp": int(time.time() * 1000),
            "status": "open",
        }
        self.orders[oid] = entry
        if USE_SQLITE:
            import asyncio
            try:
                asyncio.get_event_loop().create_task(self._save_order_db(entry))
            except RuntimeError:
                pass
        else:
            self._save_json()
        return OrderResponse(**entry)

    def get_order(self, oid: str) -> Optional[OrderResponse]:
        entry = self.orders.get(oid)
        if entry:
            return OrderResponse(**entry)
        return None

    def get_orders(self, pair: Optional[str] = None) -> list[OrderResponse]:
        items = list(self.orders.values())
        if pair and "_" in pair:
            tokens = pair.split("_")
            items = [
                o for o in items
                if o["makerToken"] in tokens and o["takerToken"] in tokens
            ]
        items.sort(key=lambda o: o["timestamp"], reverse=True)
        return [OrderResponse(**o) for o in items]

    def cancel(self, oid: str) -> bool:
        if oid in self.orders:
            self.orders[oid]["status"] = "cancelled"
            if USE_SQLITE:
                import asyncio
                try:
                    asyncio.get_event_loop().create_task(self._update_status_db(oid, "cancelled"))
                except RuntimeError:
                    pass
            else:
                self._save_json()
            return True
        return False

    def fill(self, oid: str) -> bool:
        if oid in self.orders and self.orders[oid]["status"] == "open":
            self.orders[oid]["status"] = "completed"
            if USE_SQLITE:
                import asyncio
                try:
                    asyncio.get_event_loop().create_task(self._update_status_db(oid, "completed"))
                except RuntimeError:
                    pass
            else:
                self._save_json()
            return True
        return False

    def count(self) -> int:
        return len([o for o in self.orders.values() if o["status"] == "open"])


orderbook = Orderbook()
