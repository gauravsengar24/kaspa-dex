import math
import time
from typing import List, Optional, Tuple


class LLAMMABand:
    """Single band in the LLAMMA AMM"""
    def __init__(self, index: int, price_up: float, price_down: float, A: float):
        self.index = index
        self.price_up = price_up
        self.price_down = price_down
        self.A = A
        self.collateral_amount = 0.0
        self.stablecoin_amount = 0.0


class LLAMMA:
    """Lending-Liquidating AMM (Curve crvUSD)
    Soft liquidation via concentrated liquidity bands
    """

    def __init__(self, A: float = 5.0, base_price: float = 1.0, fee: float = 0.003,
                 max_bands: int = 50):
        self.A = A
        self.base_price = base_price
        self.fee = fee
        self.max_bands = max_bands
        self.rate = 0.05  # base interest rate
        self.rate_mul = 1.0
        self.bands: List[LLAMMABand] = []
        self._init_bands()

    def _init_bands(self):
        self.bands = []
        for n in range(self.max_bands):
            p_up = self.base_price * ((self.A - 1) / self.A) ** n
            p_down = self.base_price * ((self.A - 1) / self.A) ** (n + 1)
            band = LLAMMABand(index=n, price_up=p_up, price_down=p_down, A=self.A)
            self.bands.append(band)

    def oracle_price(self) -> float:
        return self.base_price

    def active_band(self) -> int:
        p_oracle = self.oracle_price()
        for n, band in enumerate(self.bands):
            if band.price_down <= p_oracle <= band.price_up:
                return n
        return 0

    def swap(self, amount_in: float, is_collateral_in: bool) -> Tuple[float, float]:
        """Swap between collateral and stablecoin within bands.
        When price drops, collateral is automatically converted to stablecoin (soft liquidation).
        """
        fee_amt = amount_in * self.fee
        eff_in = amount_in - fee_amt
        total_out = 0.0
        band0 = self.active_band()

        if is_collateral_in:
            for i in range(band0, len(self.bands)):
                band = self.bands[i]
                available = band.stablecoin_amount
                if available <= 0:
                    continue
                out = min(eff_in * band.price_up, available)
                band.collateral_amount += out / band.price_up
                band.stablecoin_amount -= out
                total_out += out
                eff_in -= out / band.price_up
                if eff_in <= 0:
                    break
        else:
            for i in range(band0, -1, -1):
                band = self.bands[i]
                available = band.collateral_amount
                if available <= 0:
                    continue
                out = min(eff_in / band.price_up, available)
                band.stablecoin_amount += out * band.price_up
                band.collateral_amount -= out
                total_out += out * band.price_up
                eff_in -= out
                if eff_in <= 0:
                    break

        return total_out, fee_amt

    def get_health(self, collateral_amount: float, debt_amount: float,
                   liquidation_discount: float = 0.05) -> float:
        p_oracle = self.oracle_price()
        collateral_value = collateral_amount * p_oracle
        health = collateral_value * (1 - liquidation_discount) / max(debt_amount, 1)
        return health

    def calculate_liquidation_price(self, debt: float, collateral: float,
                                     liquidation_discount: float = 0.05) -> float:
        if collateral <= 0:
            return 0.0
        return debt / (collateral * (1 - liquidation_discount))

    def get_collateral_value(self, amount: float) -> float:
        total = 0.0
        for band in self.bands:
            total += band.collateral_amount * ((band.price_up + band.price_down) / 2)
        return total
