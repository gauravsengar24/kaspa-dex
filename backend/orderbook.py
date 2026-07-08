import json
import time
import uuid
from pathlib import Path
from typing import Optional

from backend.models import OrderCreate, OrderResponse

DATA_FILE = Path("orderbook_data.json")


class Orderbook:
    def __init__(self):
        self.orders: dict[str, dict] = {}
        self._load()

    def _load(self):
        if DATA_FILE.exists():
            try:
                data = json.loads(DATA_FILE.read_text())
                self.orders = {o["id"]: o for o in data}
            except (json.JSONDecodeError, KeyError):
                self.orders = {}

    def _save(self):
        DATA_FILE.write_text(json.dumps(list(self.orders.values()), indent=2))

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
        self._save()
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
            self._save()
            return True
        return False

    def fill(self, oid: str) -> bool:
        if oid in self.orders and self.orders[oid]["status"] == "open":
            self.orders[oid]["status"] = "completed"
            self._save()
            return True
        return False

    def count(self) -> int:
        return len([o for o in self.orders.values() if o["status"] == "open"])


orderbook = Orderbook()
