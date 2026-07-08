from abc import ABC, abstractmethod
from typing import Optional


class TokenizedStrategy(ABC):
    """ERC-4626 compliant strategy (Yearn V3 TokenizedStrategy)"""

    def __init__(self, name: str, asset: str):
        self.name = name
        self.asset = asset
        self.total_assets = 0.0
        self.last_report = 0.0

    @abstractmethod
    def deploy_funds(self, amount: float) -> float:
        ...

    @abstractmethod
    def free_funds(self, amount: float) -> float:
        ...

    @abstractmethod
    def harvest_and_report(self) -> tuple[float, float]:
        ...

    def tend(self) -> Optional[float]:
        return None

    def tend_trigger(self) -> bool:
        return False

    def available_deposit_limit(self) -> float:
        return float('inf')

    def available_withdraw_limit(self) -> float:
        return self.total_assets
