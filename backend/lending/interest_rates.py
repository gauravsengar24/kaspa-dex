from typing import Protocol


class InterestRateModel(Protocol):
    def get_borrow_rate(self, utilization: float) -> float: ...
    def get_supply_rate(self, utilization: float) -> float: ...


class KinkedRateModel:
    """Piecewise linear with a kink (Compound-style)"""

    def __init__(self, base_rate: float = 0.02, multiplier: float = 0.1,
                 kink: float = 0.8, jump_multiplier: float = 2.0, reserve_factor: float = 0.1):
        self.base_rate = base_rate
        self.multiplier = multiplier
        self.kink = kink
        self.jump_multiplier = jump_multiplier
        self.reserve_factor = reserve_factor

    def get_borrow_rate(self, utilization: float) -> float:
        utilization = min(max(utilization, 0), 1.0)
        if utilization <= self.kink:
            return self.base_rate + utilization * self.multiplier
        excess = utilization - self.kink
        kink_rate = self.base_rate + self.kink * self.multiplier
        return kink_rate + excess * self.jump_multiplier

    def get_supply_rate(self, utilization: float) -> float:
        borrow = self.get_borrow_rate(utilization)
        return borrow * utilization * (1 - self.reserve_factor)


class EMARateModel:
    """EMA-smoothed rate model (Curve-style)"""

    def __init__(self, base_rate: float = 0.02, multiplier: float = 0.3,
                 kink: float = 0.8, ema_alpha: float = 0.1):
        self.base_rate = base_rate
        self.multiplier = multiplier
        self.kink = kink
        self.ema_alpha = ema_alpha
        self._ema_utilization = 0.0

    def get_borrow_rate(self, utilization: float) -> float:
        self._ema_utilization = (self.ema_alpha * utilization +
                                 (1 - self.ema_alpha) * self._ema_utilization)
        u = min(max(self._ema_utilization, 0), 1.0)
        if u <= self.kink:
            return self.base_rate + u * self.multiplier
        return self.base_rate + self.kink * self.multiplier + (u - self.kink) * self.multiplier * 3

    def get_supply_rate(self, utilization: float) -> float:
        return self.get_borrow_rate(utilization) * utilization * 0.9


class SemiLogRateModel:
    """Semi-logarithmic rate curve (Curve-style)"""

    def __init__(self, base_rate: float = 0.01, slope: float = 0.05, pole: float = 0.995):
        self.base_rate = base_rate
        self.slope = slope
        self.pole = pole

    def get_borrow_rate(self, utilization: float) -> float:
        u = min(max(utilization, 0), self.pole * 0.999)
        return self.base_rate + self.slope / (self.pole - u)

    def get_supply_rate(self, utilization: float) -> float:
        return self.get_borrow_rate(utilization) * utilization * 0.9
