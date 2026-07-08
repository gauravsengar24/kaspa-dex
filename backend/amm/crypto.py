import math
import time
from typing import List, Optional


class CryptoPool:
    """Dynamic Weight AMM for volatile assets (Curve tricrypto-ng)
    Uses EMA-updated price scale and gamma parameter
    """

    def __init__(self, balances: List[float], A: float = 170.0, gamma: float = 0.000145,
                 fee: float = 0.0004, price_scale: Optional[List[float]] = None):
        self.balances = list(balances)
        self.n = len(balances)
        self.A = A
        self.gamma = gamma
        self.fee = fee
        self.price_scale = price_scale or [1.0] * (self.n - 1)
        self.last_price = list(self.price_scale)
        self.ema_price = list(self.price_scale)
        self.xcp_profit = 1.0  # virtual profit accumulator
        self.last_timestamp = time.time()

    def _update_ema(self):
        now = time.time()
        dt = now - self.last_timestamp
        if dt > 0:
            alpha = math.exp(-dt / 3600)  # 1-hour EMA window
            for i in range(self.n - 1):
                self.ema_price[i] = alpha * self.ema_price[i] + (1 - alpha) * self.last_price[i]
        self.last_timestamp = now

    def _oracle_price(self, i: int) -> float:
        self._update_ema()
        return self.ema_price[min(i, len(self.ema_price) - 1)]

    def _adjusted_balances(self) -> List[float]:
        adj = list(self.balances)
        for i in range(1, self.n):
            if i - 1 < len(self.price_scale):
                adj[i] *= self.price_scale[i - 1]
        return adj

    def swap_out_given_in(self, i: int, j: int, dx: float) -> float:
        adj = self._adjusted_balances()
        fee_amt = dx * self.fee
        eff_in = dx - fee_amt

        adj[i] += eff_in
        D = sum(adj)

        price_i = self._oracle_price(i) if i > 0 else 1.0
        price_j = self._oracle_price(j) if j > 0 else 1.0

        dy = ((adj[j] * D) / (sum(adj))) - adj[j] + fee_amt
        dy = dy * price_i / price_j

        self.balances[i] += dx
        self.balances[j] -= dy

        self.last_price[j - 1] = dy / dx if dx > 0 else self.last_price[j - 1]
        self._update_ema()

        return dy

    def get_price(self, i: int = 0, j: int = 1) -> float:
        adj = self._adjusted_balances()
        return adj[i] / adj[j] if adj[j] > 0 else 0.0

    def get_output_estimate(self, i: int, j: int, dx: float) -> float:
        eff_in = dx * (1 - self.fee)
        adj = self._adjusted_balances()
        adj[i] += eff_in
        D = sum(adj)
        price_i = self._oracle_price(i) if i > 0 else 1.0
        price_j = self._oracle_price(j) if j > 0 else 1.0
        dy = ((adj[j] * D) / (sum(adj))) - adj[j]
        return dy * price_i / price_j

    def virtual_price(self) -> float:
        D = sum(self._adjusted_balances())
        total_supply = sum(self.balances)
        return D / total_supply if total_supply > 0 else 1.0
