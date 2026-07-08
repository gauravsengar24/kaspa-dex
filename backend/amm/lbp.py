import time
from typing import List, Optional


class LBPPool:
    """Liquidity Bootstrapping Pool — dynamic weights over time (Balancer)
    Start weight_A high (e.g. 0.95), end weight_A low (e.g. 0.50)
    Linearly interpolates weights between start_time and end_time
    """

    def __init__(self, balances: List[float], start_weights: List[float], end_weights: List[float],
                 start_time: float, end_time: float, fee: float = 0.01):
        self.balances = list(balances)
        self.start_weights = list(start_weights)
        self.end_weights = list(end_weights)
        self.start_time = start_time
        self.end_time = end_time
        self.fee = fee
        self.n = len(balances)
        self._paused = False
        self._sell_only = True
        self._whitelist: List[str] = []

    def _current_weights(self, t: Optional[float] = None) -> List[float]:
        if t is None:
            t = time.time()
        if t <= self.start_time:
            return list(self.start_weights)
        if t >= self.end_time:
            return list(self.end_weights)
        elapsed = (t - self.start_time) / (self.end_time - self.start_time)
        return [
            s + (e - s) * elapsed
            for s, e in zip(self.start_weights, self.end_weights)
        ]

    def spot_price(self, token_in: int, token_out: int, t: Optional[float] = None) -> float:
        w = self._current_weights(t)
        if self.balances[token_out] == 0 or w[token_out] == 0:
            return 0.0
        return (self.balances[token_in] / w[token_in]) / (self.balances[token_out] / w[token_out])

    def swap_out_given_in(self, token_in: int, token_out: int, amount_in: float, sender: Optional[str] = None) -> float:
        if self._paused:
            raise ValueError("Pool is paused")
        if self._sell_only:
            raise ValueError("Pool is in sell-only mode — no buys allowed")
        if self._whitelist and sender and sender not in self._whitelist:
            raise ValueError("Sender not whitelisted")

        w = self._current_weights()
        fee_amt = amount_in * self.fee
        eff_in = amount_in - fee_amt

        numerator = self.balances[token_out] * ((self.balances[token_in] / (self.balances[token_in] + eff_in)) ** (w[token_in] / w[token_out]) - 1)
        amount_out = abs(numerator)

        self.balances[token_in] += amount_in
        self.balances[token_out] -= amount_out

        return amount_out

    def pause(self, sell_only: bool = True):
        self._paused = True
        self._sell_only = sell_only

    def unpause(self):
        self._paused = False
        self._sell_only = False

    def set_whitelist(self, addresses: List[str]):
        self._whitelist = addresses
