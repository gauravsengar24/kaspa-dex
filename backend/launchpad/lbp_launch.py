import time
import uuid
from typing import Optional


class LBPLAunch:
    """Liquidity Bootstrapping Pool for token launches (Balancer)"""

    def __init__(self, project_token: str, base_token: str = "KAS",
                 project_amount: float = 1_000_000, base_amount: float = 100_000,
                 duration_hours: float = 72):
        self.id = str(uuid.uuid4())
        self.project_token = project_token
        self.base_token = base_token
        self.project_amount = project_amount
        self.base_amount = base_amount
        self.start_time = time.time() + 3600
        self.end_time = self.start_time + duration_hours * 3600
        self.paused = True  # starts in sell-only
        self.current_project_weight = 0.95
        self.current_base_weight = 0.05

    def _weights_at(self, t: Optional[float] = None) -> tuple[float, float]:
        if t is None:
            t = time.time()
        if t <= self.start_time:
            return 0.95, 0.05
        if t >= self.end_time:
            return 0.50, 0.50
        elapsed = (t - self.start_time) / (self.end_time - self.start_time)
        pw = 0.95 - (0.95 - 0.50) * elapsed
        bw = 1.0 - pw
        return pw, bw

    def get_price(self) -> float:
        pw, bw = self._weights_at()
        return (self.base_amount / bw) / (self.project_amount / pw)

    def swap_base_for_project(self, base_amount: float) -> float:
        if self.paused:
            raise ValueError("LBP is paused")
        pw, bw = self._weights_at()
        fee = base_amount * 0.01
        eff_in = base_amount - fee
        ratio = self.base_amount / (self.base_amount + eff_in)
        new_project = self.project_amount * (ratio ** (bw / pw))
        project_out = self.project_amount - new_project
        self.base_amount += base_amount
        self.project_amount -= project_out
        return project_out

    def start(self):
        self.paused = False

    def get_state(self) -> dict:
        pw, bw = self._weights_at()
        return {
            "id": self.id,
            "project_token": self.project_token,
            "base_token": self.base_token,
            "project_weight": round(pw * 100, 1),
            "base_weight": round(bw * 100, 1),
            "price": self.get_price(),
            "paused": self.paused,
        }
