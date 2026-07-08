import math
from typing import Optional
from pydantic import BaseModel

MIN_TICK = -887272
MAX_TICK = 887272
Q96 = 2 ** 96
Q128 = 2 ** 128


def tick_to_sqrt_price(tick: int) -> int:
    return int(math.sqrt(1.0001 ** tick) * Q96)


def sqrt_price_to_tick(sqrt_price: int) -> int:
    ratio = sqrt_price / Q96
    return int(math.log(ratio, 1.0001))


def get_amount_0_delta(sqrt_price_a: int, sqrt_price_b: int, liquidity: int, round_up: bool = False) -> int:
    if sqrt_price_a > sqrt_price_b:
        sqrt_price_a, sqrt_price_b = sqrt_price_b, sqrt_price_a
    diff = sqrt_price_b - sqrt_price_a
    num = liquidity * diff
    den = sqrt_price_b * sqrt_price_a
    if round_up:
        return (num + den - 1) // den
    return num // den


def get_amount_1_delta(sqrt_price_a: int, sqrt_price_b: int, liquidity: int, round_up: bool = False) -> int:
    if sqrt_price_a > sqrt_price_b:
        sqrt_price_a, sqrt_price_b = sqrt_price_b, sqrt_price_a
    diff = sqrt_price_b - sqrt_price_a
    num = liquidity * diff
    den = Q96
    if round_up:
        return (num + den - 1) // den
    return num // den


class TickInfo:
    def __init__(self, tick: int, liquidity_gross: int = 0, liquidity_net: int = 0):
        self.tick = tick
        self.liquidity_gross = liquidity_gross
        self.liquidity_net = liquidity_net
        self.fee_growth_outside_0 = 0
        self.fee_growth_outside_1 = 0


class Position:
    def __init__(self, owner: str, tick_lower: int, tick_upper: int):
        self.owner = owner
        self.tick_lower = tick_lower
        self.tick_upper = tick_upper
        self.liquidity = 0
        self.fees_owed_0 = 0.0
        self.fees_owed_1 = 0.0


class CLMMPool:
    """Concentrated Liquidity Market Maker (Uniswap V3/V4)"""

    def __init__(self, token0: str, token1: str, fee: float = 0.003, tick_spacing: int = 60):
        self.token0 = token0
        self.token1 = token1
        self.fee = fee
        self.tick_spacing = tick_spacing
        self.sqrt_price = tick_to_sqrt_price(0)
        self.tick_current = 0
        self.liquidity = 0
        self.fee_growth_global_0 = 0.0
        self.fee_growth_global_1 = 0.0
        self.reserve0 = 0.0
        self.reserve1 = 0.0
        self.ticks: dict[int, TickInfo] = {}
        self.positions: dict[str, Position] = {}
        self._tick_bitmap = 0
        self._observations: list = []
        self._observation_index = 0
        self._observation_cardinality = 100
        self._observation_cardinality_next = 100

    def _get_tick(self, tick: int) -> TickInfo:
        if tick not in self.ticks:
            self.ticks[tick] = TickInfo(tick)
        return self.ticks[tick]

    def _nearest_usable_tick(self, tick: int) -> int:
        return round(tick / self.tick_spacing) * self.tick_spacing

    def mint(self, owner: str, tick_lower: int, tick_upper: int, amount0: float, amount1: float) -> tuple[float, float, float]:
        tick_lower = self._nearest_usable_tick(tick_lower)
        tick_upper = self._nearest_usable_tick(tick_upper)
        sqrt_a = tick_to_sqrt_price(tick_lower)
        sqrt_b = tick_to_sqrt_price(tick_upper)

        liquidity = min(
            (amount0 * sqrt_a * sqrt_b / Q96 / (sqrt_b - sqrt_a)) if sqrt_b > sqrt_a else float('inf'),
            (amount1 * Q96 / (sqrt_b - sqrt_a)) if sqrt_b > sqrt_a else float('inf')
        )

        pos_key = f"{owner}:{tick_lower}:{tick_upper}"
        if pos_key not in self.positions:
            self.positions[pos_key] = Position(owner, tick_lower, tick_upper)

        pos = self.positions[pos_key]
        pos.liquidity += liquidity
        self.liquidity += liquidity

        self.reserve0 += float(amount0)
        self.reserve1 += float(amount1)

        tick_info_low = self._get_tick(tick_lower)
        tick_info_high = self._get_tick(tick_upper)
        tick_info_low.liquidity_net += int(liquidity)
        tick_info_high.liquidity_net -= int(liquidity)

        return float(amount0), float(amount1), liquidity

    def swap(self, amount_in: float, token_in_is_0: bool, sqrt_price_limit: Optional[int] = None) -> tuple[float, float]:
        if amount_in <= 0:
            return 0.0, 0.0

        fee_amount = amount_in * self.fee
        effective_in = amount_in - fee_amount

        if token_in_is_0:
            new_sqrt_price = (self.sqrt_price * self.reserve0) / (self.reserve0 + effective_in * self.sqrt_price)
            amount_out = self.reserve1 - (self.liquidity * Q96 / new_sqrt_price)
            self.reserve0 += effective_in
            self.reserve1 -= amount_out
        else:
            new_sqrt_price = (self.sqrt_price * self.reserve1) / (self.reserve1 + effective_in / self.sqrt_price)
            amount_out = self.reserve0 - (self.liquidity * new_sqrt_price / Q96)
            self.reserve1 += effective_in
            self.reserve0 -= amount_out

        self.sqrt_price = new_sqrt_price
        self.fee_growth_global_0 += fee_amount / self.liquidity if self.liquidity > 0 else 0
        self.fee_growth_global_1 += fee_amount / self.liquidity if self.liquidity > 0 else 0

        return amount_out, fee_amount

    def burn(self, owner: str, tick_lower: int, tick_upper: int, liquidity: float) -> tuple[float, float]:
        pos_key = f"{owner}:{tick_lower}:{tick_upper}"
        if pos_key not in self.positions:
            return 0.0, 0.0
        pos = self.positions[pos_key]
        shares = liquidity / pos.liquidity if pos.liquidity > 0 else 0
        amount0 = self.reserve0 * shares
        amount1 = self.reserve1 * shares
        pos.liquidity -= liquidity
        self.liquidity -= liquidity
        self.reserve0 -= amount0
        self.reserve1 -= amount1
        return amount0, amount1

    def collect_fees(self, owner: str, tick_lower: int, tick_upper: int) -> tuple[float, float]:
        pos_key = f"{owner}:{tick_lower}:{tick_upper}"
        if pos_key not in self.positions:
            return 0.0, 0.0
        pos = self.positions[pos_key]
        fees0 = pos.fees_owed_0
        fees1 = pos.fees_owed_1
        pos.fees_owed_0 = 0
        pos.fees_owed_1 = 0
        return fees0, fees1

    def get_output_estimate(self, amount_in: float, token_in_is_0: bool) -> float:
        fee_amt = amount_in * self.fee
        eff_in = amount_in - fee_amt
        if token_in_is_0:
            new_p = (self.sqrt_price * self.reserve0) / (self.reserve0 + eff_in * self.sqrt_price)
            return self.reserve1 - (self.liquidity * Q96 / new_p)
        else:
            new_p = (self.sqrt_price * self.reserve1) / (self.reserve1 + eff_in / self.sqrt_price)
            return self.reserve0 - (self.liquidity * new_p / Q96)

    def get_price(self) -> float:
        return (self.sqrt_price / Q96) ** 2

    def spot_price(self) -> float:
        return self.reserve1 / self.reserve0 if self.reserve0 > 0 else 0.0

    def price_impact(self, amount_in: float, token_in_is_0: bool) -> float:
        spot = self.spot_price()
        est_out = self.get_output_estimate(amount_in, token_in_is_0)
        exec_price = est_out / amount_in if amount_in > 0 else 0
        return abs((exec_price - spot) / spot) * 100 if spot > 0 else 0.0
