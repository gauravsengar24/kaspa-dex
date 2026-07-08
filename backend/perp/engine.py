import time
import uuid
import math
from enum import Enum
from typing import Optional, List, Dict


class OrderSide(Enum):
    LONG = "long"
    SHORT = "short"


class MarketOrder:
    def __init__(self, user: str, side: OrderSide, size: float, leverage: float,
                 price: float, reduce_only: bool = False):
        self.id = str(uuid.uuid4())
        self.user = user
        self.side = side
        self.size = size
        self.leverage = max(1.0, min(leverage, 50.0))
        self.price = price
        self.reduce_only = reduce_only
        self.timestamp = time.time()


class Position:
    def __init__(self, user: str, side: OrderSide, size: float, entry_price: float,
                 leverage: float, liquidation_price: float):
        self.id = str(uuid.uuid4())
        self.user = user
        self.side = side
        self.size = size
        self.entry_price = entry_price
        self.leverage = leverage
        self.liquidation_price = liquidation_price
        self.collateral = (size * entry_price) / leverage


class PerpEngine:
    """Perpetual futures engine with cross-margin and funding"""

    def __init__(self, maintenance_margin: float = 0.005):
        self.positions: Dict[str, Position] = {}
        self.orders: List[MarketOrder] = []
        self.balances: Dict[str, float] = {}  # user -> available balance
        self.funding_rate = 0.0001
        self.last_funding_time = time.time()
        self.maintenance_margin = maintenance_margin

    def _get_or_create_balance(self, user: str) -> float:
        if user not in self.balances:
            self.balances[user] = 10000  # paper trading starting balance
        return self.balances[user]

    def open_position(self, user: str, side: OrderSide, size: float,
                      leverage: float, current_price: float) -> dict:
        bal = self._get_or_create_balance(user)
        margin_required = (size * current_price) / leverage

        if bal < margin_required:
            return {"error": "Insufficient margin", "required": margin_required, "available": bal}

        liq_price = self._calc_liquidation_price(
            current_price, leverage, side
        )

        position = Position(user, side, size, current_price, leverage, liq_price)
        self.positions[user] = position
        self.balances[user] -= margin_required

        return {
            "position_id": position.id,
            "side": side.value,
            "size": size,
            "entry_price": current_price,
            "leverage": leverage,
            "liquidation_price": liq_price,
            "collateral": position.collateral,
            "margin_used": margin_required,
        }

    def close_position(self, user: str, current_price: float) -> dict:
        pos = self.positions.get(user)
        if not pos:
            return {"error": "No open position"}

        pnl, direction = self._calculate_pnl(pos, current_price)
        fee = pos.size * current_price * 0.0006
        total_return = pos.collateral + pnl - fee

        self.balances[user] = self._get_or_create_balance(user) + max(total_return, 0)
        del self.positions[user]

        return {
            "pnl": pnl,
            "pnl_pct": (pnl / pos.collateral * 100) if pos.collateral > 0 else 0,
            "fee": fee,
            "returned": max(total_return, 0),
            "exit_price": current_price,
            "side": pos.side.value,
            "direction": direction,
        }

    def get_position(self, user: str) -> Optional[dict]:
        pos = self.positions.get(user)
        if not pos:
            return None
        return {
            "id": pos.id,
            "user": pos.user,
            "side": pos.side.value,
            "size": pos.size,
            "entry_price": pos.entry_price,
            "leverage": pos.leverage,
            "liquidation_price": pos.liquidation_price,
            "collateral": pos.collateral,
        }

    def get_unrealized_pnl(self, user: str, current_price: float) -> dict:
        pos = self.positions.get(user)
        if not pos:
            return {"pnl": 0, "pnl_pct": 0, "roe": 0}

        pnl, direction = self._calculate_pnl(pos, current_price)
        roe = (pnl / pos.collateral * 100) if pos.collateral > 0 else 0

        liq_distance = 0
        if pos.liquidation_price > 0:
            if pos.side == OrderSide.LONG:
                liq_distance = ((current_price - pos.liquidation_price) / pos.liquidation_price) * 100
            else:
                liq_distance = ((pos.liquidation_price - current_price) / pos.liquidation_price) * 100

        return {
            "pnl": pnl,
            "pnl_pct": (pnl / (pos.size * pos.entry_price) * 100) if pos.size * pos.entry_price > 0 else 0,
            "roe": roe,
            "margin_used": pos.collateral,
            "liquidation_distance_pct": round(liq_distance, 2),
            "direction": direction,
        }

    def check_liquidation(self, user: str, current_price: float) -> Optional[dict]:
        pos = self.positions.get(user)
        if not pos:
            return None

        if pos.side == OrderSide.LONG and current_price <= pos.liquidation_price:
            del self.positions[user]
            return {"liquidated": True, "price": current_price, "side": "long"}
        elif pos.side == OrderSide.SHORT and current_price >= pos.liquidation_price:
            del self.positions[user]
            return {"liquidated": True, "price": current_price, "side": "short"}

        return {"liquidated": False}

    def _calc_liquidation_price(self, entry: float, leverage: float, side: OrderSide) -> float:
        mm = self.maintenance_margin
        if side == OrderSide.LONG:
            return entry * (1 - (1 - mm) / leverage)
        else:
            return entry * (1 + (1 - mm) / leverage)

    def _calculate_pnl(self, pos: Position, current_price: float) -> tuple:
        if pos.side == OrderSide.LONG:
            pnl = (current_price - pos.entry_price) * pos.size
            direction = "up" if current_price > pos.entry_price else "down"
        else:
            pnl = (pos.entry_price - current_price) * pos.size
            direction = "up" if current_price < pos.entry_price else "down"
        return pnl, direction

    def get_account_summary(self, user: str, current_price: float) -> dict:
        bal = self._get_or_create_balance(user)
        pos = self.positions.get(user)
        unrealized = 0
        if pos:
            pnl, _ = self._calculate_pnl(pos, current_price)
            unrealized = pnl

        return {
            "wallet_balance": bal,
            "unrealized_pnl": unrealized,
            "margin_used": pos.collateral if pos else 0,
            "free_margin": bal - (pos.collateral if pos else 0),
            "equity": bal + unrealized,
            "has_position": pos is not None,
        }

    def get_funding_rate(self) -> float:
        return self.funding_rate

    def set_funding_rate(self, rate: float):
        self.funding_rate = max(-0.001, min(rate, 0.001))
