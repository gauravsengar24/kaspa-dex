import math
from typing import List, Optional


class WeightedPool:
    """Generalized Weighted Constant Product Pool (Balancer)
    amountOut = balanceOut * (1 - (balanceIn / (balanceIn + amountIn))^(weightIn/weightOut))
    """

    def __init__(self, balances: List[float], weights: List[float], fee: float = 0.003):
        assert len(balances) == len(weights), "balances and weights must match"
        assert abs(sum(weights) - 1.0) < 0.001, "weights must sum to 1"
        self.balances = list(balances)
        self.weights = list(weights)
        self.fee = fee
        self.n = len(balances)
        self._invariant = self._compute_invariant()

    def _compute_invariant(self) -> float:
        inv = 1.0
        for i in range(self.n):
            if self.balances[i] > 0:
                inv *= self.balances[i] ** self.weights[i]
        return inv

    def _pow(self, base: float, exp: float) -> float:
        if base <= 0:
            return 0.0
        return base ** exp

    def swap_out_given_in(self, token_in: int, token_out: int, amount_in: float) -> float:
        assert 0 <= token_in < self.n and 0 <= token_out < self.n

        fee_amt = amount_in * self.fee
        effective_in = amount_in - fee_amt

        new_balance_in = self.balances[token_in] + effective_in
        weight_ratio = self.weights[token_in] / self.weights[token_out]

        ratio = self.balances[token_in] / new_balance_in
        new_balance_out = self.balances[token_out] * (ratio ** weight_ratio)

        amount_out = self.balances[token_out] - new_balance_out

        self.balances[token_in] = new_balance_in
        self.balances[token_out] = new_balance_out
        self._invariant = self._compute_invariant()

        return amount_out

    def swap_in_given_out(self, token_in: int, token_out: int, amount_out: float) -> float:
        assert 0 <= token_in < self.n and 0 <= token_out < self.n

        new_balance_out = self.balances[token_out] - amount_out
        weight_ratio = self.weights[token_out] / self.weights[token_in]

        ratio = new_balance_out / self.balances[token_out]
        new_balance_in = self.balances[token_in] * (ratio ** weight_ratio)

        amount_in = (self.balances[token_in] - new_balance_in) / (1 - self.fee)

        self.balances[token_in] = new_balance_in + (amount_in - amount_in * (1 - self.fee))
        self.balances[token_out] = new_balance_out
        self._invariant = self._compute_invariant()

        return amount_in

    def add_liquidity_unbalanced(self, amounts: List[float]) -> List[float]:
        """Add liquidity, pay fees on non-proportional portion"""
        total_share = 0.0
        actual_added = [0.0] * self.n

        for i in range(self.n):
            if self.balances[i] > 0:
                share = amounts[i] / self.balances[i]
                total_share = max(total_share, share)
            else:
                actual_added[i] = amounts[i]
                self.balances[i] += amounts[i]

        for i in range(self.n):
            if self.balances[i] > 0:
                proportional = self.balances[i] * total_share
                if amounts[i] > proportional:
                    fee_on_excess = (amounts[i] - proportional) * self.fee
                    actual_added[i] = amounts[i] - fee_on_excess
                else:
                    actual_added[i] = amounts[i]
                self.balances[i] += actual_added[i]

        self._invariant = self._compute_invariant()
        return actual_added

    def remove_liquidity_proportional(self, shares: float) -> List[float]:
        amounts = [b * shares for b in self.balances]
        for i in range(self.n):
            self.balances[i] -= amounts[i]
        self._invariant = self._compute_invariant()
        return amounts

    def get_price(self, token_in: int, token_out: int) -> float:
        if self.balances[token_out] == 0:
            return 0.0
        return (self.balances[token_in] / self.weights[token_in]) / (
            self.balances[token_out] / self.weights[token_out]
        ) * self.weights[token_out] / self.weights[token_in]

    def get_output_estimate(self, token_in: int, token_out: int, amount_in: float) -> float:
        eff_in = amount_in * (1 - self.fee)
        new_in = self.balances[token_in] + eff_in
        wr = self.weights[token_in] / self.weights[token_out]
        ratio = self.balances[token_in] / new_in
        new_out = self.balances[token_out] * (ratio ** wr)
        return self.balances[token_out] - new_out

    def spot_price(self, token_in: int, token_out: int) -> float:
        return (self.balances[token_in] / self.weights[token_in]) / (
            self.balances[token_out] / self.weights[token_out]
        )

    def price_impact(self, token_in: int, token_out: int, amount_in: float) -> float:
        spot = self.spot_price(token_in, token_out)
        est_out = self.get_output_estimate(token_in, token_out, amount_in)
        exec_price = est_out / amount_in if amount_in > 0 else 0
        return abs((exec_price - spot) / spot) * 100 if spot > 0 else 0.0
