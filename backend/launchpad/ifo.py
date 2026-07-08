import time
import uuid
from typing import Optional


class IFO:
    """Initial Farm Offering — tiered token launchpad (PancakeSwap)"""

    def __init__(self, token: str, token_amount: float, base_token: str = "KAS",
                 start_time: Optional[float] = None, end_time: Optional[float] = None):
        self.id = str(uuid.uuid4())
        self.token = token
        self.token_amount = token_amount
        self.base_token = base_token
        self.start_time = start_time or time.time() + 86400
        self.end_time = end_time or time.time() + 86400 * 3
        self.hard_cap = token_amount
        self.soft_cap = token_amount * 0.3
        self.total_committed = 0.0
        self.total_participants = 0
        self.vesting_duration = 86400 * 30
        self.vesting_cliff = 86400 * 7
        self.sales_rounds = {
            "public": {"allocation": token_amount * 0.5, "committed": 0.0},
            "private": {"allocation": token_amount * 0.5, "committed": 0.0},
        }
        self._participants: dict = {}

    def commit(self, user: str, amount: float, round_name: str = "public") -> float:
        if round_name not in self.sales_rounds:
            raise ValueError(f"Unknown round: {round_name}")
        round_data = self.sales_rounds[round_name]
        available = round_data["allocation"] - round_data["committed"]
        capped = min(amount, available)
        round_data["committed"] += capped
        self.total_committed += capped
        if user not in self._participants:
            self._participants[user] = {"committed": 0, "round": round_name}
            self.total_participants += 1
        self._participants[user]["committed"] += capped
        return capped

    def calculate_allocation(self, user: str) -> float:
        if user not in self._participants:
            return 0.0
        participant = self._participants[user]
        round_data = self.sales_rounds.get(participant["round"], {})
        total_round = round_data.get("committed", 0)
        if total_round == 0:
            return 0.0
        share = participant["committed"] / total_round
        return round_data["allocation"] * share

    def get_state(self) -> dict:
        return {
            "id": self.id,
            "token": self.token,
            "hard_cap": self.hard_cap,
            "soft_cap": self.soft_cap,
            "total_committed": self.total_committed,
            "total_participants": self.total_participants,
            "progress": round(self.total_committed / self.hard_cap * 100, 2) if self.hard_cap > 0 else 0,
            "rounds": self.sales_rounds,
        }
