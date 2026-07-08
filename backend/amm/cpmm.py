import math
from typing import Optional
from pydantic import BaseModel


class CPMMPool:
    """Constant Product Market Maker — x*y=k (Uniswap V2)"""

    def __init__(self, reserve0: float, reserve1: float, fee: float = 0.003):
        self.reserve0 = reserve0
        self.reserve1 = reserve1
        self.fee = fee
        self.k = reserve0 * reserve1

    def swap_out_given_in(self, amount_in: float, token_in_is_0: bool) -> float:
        fee_amount = amount_in * self.fee
        effective_in = amount_in - fee_amount
        if token_in_is_0:
            new_reserve0 = self.reserve0 + effective_in
            new_reserve1 = self.k / new_reserve0
            amount_out = self.reserve1 - new_reserve1
            self.reserve0 = new_reserve0
            self.reserve1 = new_reserve1
        else:
            new_reserve1 = self.reserve1 + effective_in
            new_reserve0 = self.k / new_reserve1
            amount_out = self.reserve0 - new_reserve0
            self.reserve0 = new_reserve0
            self.reserve1 = new_reserve1
        self.k = self.reserve0 * self.reserve1
        return amount_out

    def swap_in_given_out(self, amount_out: float, token_out_is_0: bool) -> float:
        if token_out_is_0:
            new_reserve0 = self.reserve0 - amount_out
            new_reserve1 = self.k / new_reserve0
            amount_in = (new_reserve1 - self.reserve1) / (1 - self.fee)
            self.reserve0 = new_reserve0
            self.reserve1 = new_reserve1
        else:
            new_reserve1 = self.reserve1 - amount_out
            new_reserve0 = self.k / new_reserve1
            amount_in = (new_reserve0 - self.reserve0) / (1 - self.fee)
            self.reserve0 = new_reserve0
            self.reserve1 = new_reserve1
        self.k = self.reserve0 * self.reserve1
        return amount_in

    def add_liquidity(self, amount0: float, amount1: float) -> tuple[float, float, float]:
        shares = min(amount0 / self.reserve0, amount1 / self.reserve1) if self.reserve0 > 0 else 1.0
        actual0 = shares * self.reserve0 if self.reserve0 > 0 else amount0
        actual1 = shares * self.reserve1 if self.reserve1 > 0 else amount1
        self.reserve0 += actual0
        self.reserve1 += actual1
        self.k = self.reserve0 * self.reserve1
        return actual0, actual1, shares

    def remove_liquidity(self, shares: float) -> tuple[float, float]:
        amount0 = self.reserve0 * shares
        amount1 = self.reserve1 * shares
        self.reserve0 -= amount0
        self.reserve1 -= amount1
        self.k = self.reserve0 * self.reserve1
        return amount0, amount1

    def get_price(self) -> float:
        return self.reserve0 / self.reserve1 if self.reserve1 > 0 else 0.0

    def get_output_estimate(self, amount_in: float, token_in_is_0: bool) -> float:
        effective_in = amount_in * (1 - self.fee)
        if token_in_is_0:
            new_r0 = self.reserve0 + effective_in
            new_r1 = self.k / new_r0
            return self.reserve1 - new_r1
        else:
            new_r1 = self.reserve1 + effective_in
            new_r0 = self.k / new_r1
            return self.reserve0 - new_r0

    def spot_price(self, token_is_0: bool = True) -> float:
        if token_is_0:
            return self.reserve1 / self.reserve0
        return self.reserve0 / self.reserve1

    def price_impact(self, amount_in: float, token_in_is_0: bool) -> float:
        spot = self.spot_price(token_in_is_0)
        exec_price = self.get_output_estimate(amount_in, token_in_is_0) / amount_in
        return abs((exec_price - spot) / spot) * 100 if spot > 0 else 0.0
