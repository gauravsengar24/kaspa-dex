import time
import uuid
import random
import hashlib
from typing import Optional, List, Dict


class PredictionRound:
    def __init__(self, market_id: str, round_number: int, lock_price: float,
                 duration_minutes: int = 5, min_bet: float = 1.0, max_bet: float = 10000.0):
        self.id = str(uuid.uuid4())
        self.market_id = market_id
        self.round_number = round_number
        self.lock_price = lock_price
        self.lock_time = time.time() + duration_minutes * 60
        self.end_time = self.lock_time + 30  # 30 second settlement window
        self.duration_minutes = duration_minutes
        self.min_bet = min_bet
        self.max_bet = max_bet
        self.total_bets_up = 0.0
        self.total_bets_down = 0.0
        self.bets_up: Dict[str, float] = {}
        self.bets_down: Dict[str, float] = {}
        self.settled = False
        self.result_price: Optional[float] = None
        self.result_direction: Optional[str] = None  # "up" or "down"
        self.random_hash: Optional[str] = None

    def place_bet(self, user: str, amount: float, direction: str) -> float:
        if time.time() >= self.lock_time:
            raise ValueError("Round is locked")
        capped = min(max(amount, self.min_bet), self.max_bet)
        if direction == "up":
            self.total_bets_up += capped
            self.bets_up[user] = self.bets_up.get(user, 0) + capped
        elif direction == "down":
            self.total_bets_down += capped
            self.bets_down[user] = self.bets_down.get(user, 0) + capped
        else:
            raise ValueError(f"Invalid direction: {direction}")
        return capped

    def settle(self, final_price: float):
        if self.settled:
            return
        self.result_price = final_price
        self.result_direction = "up" if final_price >= self.lock_price else "down"
        self.random_hash = hashlib.sha256(str(random.random()).encode()).hexdigest()[:16]
        self.settled = True

    def calculate_payout(self, user: str) -> float:
        if not self.settled:
            return 0.0
        if self.result_direction == "up":
            if user in self.bets_up and self.total_bets_up > 0:
                share = self.bets_up[user] / self.total_bets_up
                return share * (self.total_bets_up + self.total_bets_down)
        elif self.result_direction == "down":
            if user in self.bets_down and self.total_bets_down > 0:
                share = self.bets_down[user] / self.total_bets_down
                return share * (self.total_bets_up + self.total_bets_down)
        return 0.0


class PredictionMarket:
    """On-chain prediction market (PancakeSwap)"""

    def __init__(self, pair: str = "KAS/USD", round_duration_minutes: int = 5,
                 min_bet: float = 1.0, max_bet: float = 10000.0):
        self.id = str(uuid.uuid4())
        self.pair = pair
        self.round_duration_minutes = round_duration_minutes
        self.min_bet = min_bet
        self.max_bet = max_bet
        self.current_round_number = 0
        self.rounds: Dict[str, PredictionRound] = {}
        self._price_feed: Optional[callable] = None

    def set_price_feed(self, feed: callable):
        self._price_feed = feed

    def start_new_round(self, price: float) -> PredictionRound:
        self.current_round_number += 1
        round_obj = PredictionRound(
            market_id=self.id,
            round_number=self.current_round_number,
            lock_price=price,
            duration_minutes=self.round_duration_minutes,
            min_bet=self.min_bet,
            max_bet=self.max_bet,
        )
        self.rounds[round_obj.id] = round_obj
        return round_obj

    def get_active_round(self) -> Optional[PredictionRound]:
        for r in self.rounds.values():
            if not r.settled and time.time() < r.end_time:
                return r
        return None

    def settle_current_round(self, price: float):
        active = self.get_active_round()
        if active:
            active.settle(price)

    def get_rounds_batch(self, limit: int = 10) -> List[PredictionRound]:
        sorted_rounds = sorted(self.rounds.values(), key=lambda r: r.round_number, reverse=True)
        return sorted_rounds[:limit]

    def get_state(self) -> dict:
        active = self.get_active_round()
        return {
            "id": self.id,
            "pair": self.pair,
            "current_round": self.current_round_number,
            "active_round": {
                "id": active.id,
                "lock_price": active.lock_price,
                "lock_time": active.lock_time,
                "total_bets": active.total_bets_up + active.total_bets_down,
            } if active else None,
        }
