import time
import uuid
import math
from typing import Optional, List, Dict
from dataclasses import dataclass, field
from .interest_rates import KinkedRateModel, InterestRateModel


@dataclass
class LendingMarket:
    """An isolated lending market for one asset"""
    id: str
    token: str
    total_supply: float = 0.0
    total_borrow: float = 0.0
    total_reserves: float = 0.0
    supply_cap: float = float('inf')
    borrow_cap: float = float('inf')
    ltv: float = 0.75         # Loan-To-Value (collateral factor)
    liquidation_threshold: float = 0.80
    liquidation_bonus: float = 0.08
    reserve_factor: float = 0.10
    rate_model: InterestRateModel = field(default_factory=lambda: KinkedRateModel())
    price_usd: float = 1.0
    supply_index: float = 1.0
    borrow_index: float = 1.0
    last_update: float = field(default_factory=time.time)
    is_collateral_enabled: bool = True
    is_borrow_enabled: bool = True
    e_mode_category: int = 0  # 0 = none


@dataclass
class BorrowPosition:
    user: str
    market_id: str
    principal_borrowed: float = 0.0
    collateral_amount: float = 0.0
    collateral_market: str = ""
    borrow_index_at_open: float = 1.0
    e_mode: int = 0


@dataclass
class CompactUserState:
    """1-slot user state (Compound III)"""
    principal: int = 0        # signed: +supply, -borrow
    base_tracking_index: int = 0
    base_tracking_accrued: int = 0
    assets_in: int = 0        # bit vector


class LendingEngine:
    """Hub-and-Spoke lending engine (Aave V4 + Compound III)"""

    def __init__(self):
        self.markets: Dict[str, LendingMarket] = {}
        self.positions: Dict[str, BorrowPosition] = {}
        self.user_states: Dict[str, CompactUserState] = {}
        self._price_feeds: Dict[str, float] = {"KAS": 0.15, "USDT": 1.0, "NACHO": 0.005}

    def create_market(self, token: str, ltv: float = 0.75, lt: float = 0.80,
                      bonus: float = 0.08, supply_cap: float = float('inf'),
                      borrow_cap: float = float('inf'),
                      e_mode: int = 0) -> LendingMarket:
        market = LendingMarket(
            id=str(uuid.uuid4()),
            token=token,
            ltv=ltv,
            liquidation_threshold=lt,
            liquidation_bonus=bonus,
            supply_cap=supply_cap,
            borrow_cap=borrow_cap,
            e_mode_category=e_mode,
        )
        self.markets[market.id] = market
        return market

    def supply(self, user: str, market_id: str, amount: float) -> tuple[float, float]:
        market = self.markets[market_id]
        self._accrue(market)

        capped = min(amount, market.supply_cap - market.total_supply) if market.supply_cap < float('inf') else amount
        market.total_supply += capped

        market.supply_index = capped / max(capped, 1)

        user_key = f"{user}:supply:{market_id}"
        user_state = self.user_states.get(user_key)
        if not user_state:
            user_state = CompactUserState()
            self.user_states[user_key] = user_state
        user_state.principal += int(capped * 1e8)

        return capped, capped * market.price_usd

    def borrow(self, user: str, market_id: str, amount: float, collateral_market_id: str) -> tuple[float, str]:
        market = self.markets[market_id]
        coll_market = self.markets[collateral_market_id]
        self._accrue(market)

        coll_pos_key = f"{user}:collateral:{collateral_market_id}"
        coll_state = self.user_states.get(coll_pos_key)
        collateral_value = (coll_state.principal / 1e8) * coll_market.price_usd if coll_state else 0

        max_borrow = collateral_value * market.ltv / market.price_usd
        capped = min(amount, max_borrow, market.borrow_cap - market.total_borrow) if market.borrow_cap < float('inf') else min(amount, max_borrow)

        if capped < amount:
            return 0.0, f"Insufficient collateral. Max borrow: {max_borrow:.4f} {market.token}"

        market.total_borrow += capped
        pos = BorrowPosition(
            user=user,
            market_id=market_id,
            principal_borrowed=capped,
            collateral_market=collateral_market_id,
            collateral_amount=(capped * market.price_usd) / coll_market.price_usd,
        )
        self.positions[f"{user}:{market_id}"] = pos

        return capped, "ok"

    def repay(self, user: str, market_id: str, amount: float) -> float:
        pos_key = f"{user}:{market_id}"
        if pos_key not in self.positions:
            return 0.0
        market = self.markets[market_id]
        self._accrue(market)
        pos = self.positions[pos_key]
        repay_amt = min(amount, pos.principal_borrowed)
        market.total_borrow -= repay_amt
        market.total_reserves += repay_amt * market.reserve_factor
        pos.principal_borrowed -= repay_amt
        if pos.principal_borrowed <= 0:
            del self.positions[pos_key]
        return repay_amt

    def liquidate(self, user: str, market_id: str, liquidator: str, repay_amount: float) -> tuple[float, float]:
        pos_key = f"{user}:{market_id}"
        if pos_key not in self.positions:
            return 0.0, 0.0
        pos = self.positions[pos_key]
        market = self.markets[market_id]
        coll_market = self.markets.get(pos.collateral_market)

        health = self.get_health(user, market_id)
        if health >= 1.0:
            return 0.0, 0.0  # not liquidatable

        repay = min(repay_amount, pos.principal_borrowed)
        collateral_seized = repay * market.price_usd / coll_market.price_usd * (1 + market.liquidation_bonus)

        market.total_borrow -= repay
        pos.principal_borrowed -= repay
        coll_market.total_supply -= collateral_seized

        return repay, collateral_seized

    def get_health(self, user: str, market_id: str) -> float:
        pos_key = f"{user}:{market_id}"
        if pos_key not in self.positions:
            return 1.0
        pos = self.positions[pos_key]
        market = self.markets[market_id]
        coll_market = self.markets.get(pos.collateral_market) if pos.collateral_market else None
        if not coll_market:
            return 0.0

        collateral_value = pos.collateral_amount * coll_market.price_usd
        debt_value = pos.principal_borrowed * market.price_usd

        if debt_value == 0:
            return float('inf')

        return collateral_value / (debt_value * (1 + market.liquidation_threshold - market.ltv))

    def _accrue(self, market: LendingMarket):
        now = time.time()
        dt = now - market.last_update
        if dt > 0:
            utilization = market.total_borrow / max(market.total_supply, 1)
            borrow_rate = market.rate_model.get_borrow_rate(utilization)
            supply_rate = market.rate_model.get_supply_rate(utilization)
            market.borrow_index *= (1 + borrow_rate * dt / 365.25 / 86400)
            market.supply_index *= (1 + supply_rate * dt / 365.25 / 86400)
        market.last_update = now

    def get_utilization(self, market_id: str) -> float:
        market = self.markets[market_id]
        return market.total_borrow / max(market.total_supply, 1)

    def get_rates(self, market_id: str) -> dict:
        market = self.markets[market_id]
        utilization = self.get_utilization(market_id)
        return {
            "utilization": round(utilization * 100, 2),
            "borrow_apr": round(market.rate_model.get_borrow_rate(utilization) * 100, 2),
            "supply_apr": round(market.rate_model.get_supply_rate(utilization) * 100, 2),
        }
