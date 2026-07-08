import math
from typing import List


class StableSwapPool:
    """StableSwap AMM — Curve stableswap invariant
    A * sum(x_i) * n^n + D = A * D * n^n + D^(n+1) / (n^n * prod(x_i))
    """

    def __init__(self, balances: List[float], amplification: float = 100.0, fee: float = 0.0004):
        self.balances = list(balances)
        self.n = len(balances)
        self.A = amplification
        self.fee = fee
        self.D = self._compute_D()

    def _compute_D(self) -> float:
        S = sum(self.balances)
        if S == 0:
            return 0
        D = S
        Ann = self.A * self.n
        for _ in range(256):
            D_P = D
            for x in self.balances:
                D_P = D_P * D / (x * self.n) if x > 0 else D_P
            D_P *= D  # D^(n+1) / (n^n * prod(x_i))
            D_prev = D
            D = (Ann * S + D_P * self.n) * D / ((Ann - 1) * D + (self.n + 1) * D_P)
            if abs(D - D_prev) <= 1:
                break
        return D

    def _get_y(self, i: int, j: int, x: float, balances: List[float]) -> float:
        """Compute output y when putting x into coin i, removing from coin j"""
        Ann = self.A * self.n
        D = self._compute_D()
        c = D
        S_ = sum(balances) - balances[j]
        for b in balances:
            if b != balances[j]:
                c = c * D / (b * self.n)
        c = c * D / (Ann * self.n)
        b = S_ + D / Ann
        y_prev = 0
        y = D
        for _ in range(256):
            y_prev = y
            y = (y * y + c) / (2 * y + b - D)
            if abs(y - y_prev) <= 1:
                break
        return y

    def swap_out_given_in(self, i: int, j: int, dx: float) -> float:
        balances = list(self.balances)
        balances[i] += dx * (1 - self.fee)
        y = self._get_y(i, j, balances[i], balances)
        dy = balances[j] - y - 1
        if dy < 0:
            dy = 0
        self.balances[i] += dx
        self.balances[j] -= dy
        self.D = self._compute_D()
        return dy

    def swap_in_given_out(self, i: int, j: int, dy: float) -> float:
        balances = list(self.balances)
        balances[j] -= dy
        y = self._get_y(j, i, balances[j], balances)
        dx = (y - balances[i]) / (1 - self.fee)
        if dx < 0:
            dx = 0
        self.balances[i] += dx
        self.balances[j] -= dy
        self.D = self._compute_D()
        return dx

    def add_liquidity(self, amounts: List[float]) -> float:
        old_D = self.D
        for i in range(self.n):
            self.balances[i] += amounts[i]
        new_D = self._compute_D()
        self.D = new_D
        return new_D - old_D

    def remove_liquidity_one_coin(self, i: int, amount: float) -> float:
        balances = list(self.balances)
        balances[i] -= amount
        y = self._get_y(None, i, 0, balances)
        dy = balances[i] - y
        self.balances[i] = y
        self.D = self._compute_D()
        return dy

    def get_price(self, i: int = 0, j: int = 1) -> float:
        return self.balances[j] / self.balances[i] if self.balances[i] > 0 else 0.0

    def get_output_estimate(self, i: int, j: int, dx: float) -> float:
        fee_amt = dx * self.fee
        eff_dx = dx - fee_amt
        balances = list(self.balances)
        balances[i] += eff_dx
        y = self._get_y(i, j, balances[i], balances)
        dy = balances[j] - y - 1
        return max(dy, 0)

    def dynamic_fee(self, i: int, j: int) -> float:
        xpi = self.balances[i]
        xpj = self.balances[j]
        if xpi + xpj == 0:
            return self.fee
        imbalance = 4 * xpi * xpj / (xpi + xpj) ** 2
        offpeg_mult = 5  # offpeg_fee_multiplier
        return offpeg_mult * self.fee / ((offpeg_mult - 1) * imbalance + 1)

    def virtual_price(self) -> float:
        total_supply = sum(self.balances)
        if total_supply == 0:
            return 1.0
        return self.D / total_supply
