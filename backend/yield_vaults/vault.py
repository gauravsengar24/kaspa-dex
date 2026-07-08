import time
import uuid
import math
from typing import Optional, List, Dict
from .strategy import TokenizedStrategy


class YieldVault:
    """ERC-4626 yield vault with profit unlocking (Yearn V3)"""

    def __init__(self, name: str, asset: str, deposit_limit: float = float('inf')):
        self.id = str(uuid.uuid4())
        self.name = name
        self.asset = asset
        self.total_supply = 0.0
        self.total_idle = 0.0
        self.total_debt = 0.0
        self.deposit_limit = deposit_limit
        self.profit_max_unlock_time = 864000  # 10 days in seconds
        self.locked_profit = 0.0
        self.profit_unlocking_rate = 0.0
        self.last_profit_update = time.time()
        self.strategies: Dict[str, TokenizedStrategy] = {}
        self.withdrawal_queue: List[str] = []
        self.paused = False
        self.shutdown = False

    def convert_to_shares(self, assets: float) -> float:
        if self.total_supply == 0 or self.total_idle + self.total_debt == 0:
            return assets
        return assets * self.total_supply / (self.total_idle + self.total_debt)

    def convert_to_assets(self, shares: float) -> float:
        if self.total_supply == 0:
            return shares
        return shares * (self.total_idle + self.total_debt) / self.total_supply

    def deposit(self, assets: float, depositor: str) -> float:
        if self.paused or self.shutdown:
            raise ValueError("Vault not accepting deposits")
        capped = min(assets, self.deposit_limit - (self.total_idle + self.total_debt))
        shares = self.convert_to_shares(capped)
        self.total_idle += capped
        self.total_supply += shares
        return shares

    def withdraw(self, shares: float, owner: str) -> float:
        if self.shutdown:
            return self._emergency_withdraw(shares, owner)

        assets = self.convert_to_assets(shares)
        if assets <= self.total_idle:
            self.total_idle -= assets
            self.total_supply -= shares
            return assets

        # Walk withdrawal queue
        withdrawn = self.total_idle
        to_withdraw = assets - self.total_idle
        self.total_idle = 0

        for strat_id in self.withdrawal_queue:
            if to_withdraw <= 0:
                break
            strategy = self.strategies.get(strat_id)
            if not strategy:
                continue
            available = min(to_withdraw, strategy.available_withdraw_limit())
            if available > 0:
                freed = strategy.free_funds(available)
                withdrawn += freed
                to_withdraw -= freed
                self.total_debt -= freed

            # Unrealized loss passthrough
            if to_withdraw > 0 and strategy.total_assets > 0:
                loss_share = to_withdraw / strategy.total_assets
                strategy.total_assets -= to_withdraw * loss_share

        self.total_supply -= shares
        return withdrawn

    def add_strategy(self, strategy: TokenizedStrategy) -> str:
        sid = str(uuid.uuid4())
        self.strategies[sid] = strategy
        self.withdrawal_queue.append(sid)
        return sid

    def report(self, strategy_id: str) -> tuple[float, float, float]:
        strategy = self.strategies.get(strategy_id)
        if not strategy:
            return 0, 0, 0

        gain, loss = strategy.harvest_and_report()
        old_debt = self.total_debt

        if gain > 0:
            self._lock_profit(gain)
        if loss > 0:
            self._absorb_loss(loss)

        self.total_debt = old_debt + (strategy.total_assets - old_debt)
        return gain, loss, strategy.total_assets

    def _lock_profit(self, gain: float):
        self.locked_profit += gain
        elapsed = time.time() - self.last_profit_update
        if elapsed > 0 and self.profit_unlocking_rate > 0:
            unlocked = min(self.profit_unlocking_rate * elapsed, self.locked_profit)
            self.locked_profit -= unlocked
        self.profit_unlocking_rate = self.locked_profit / max(self.profit_max_unlock_time, 1)
        self.last_profit_update = time.time()

    def _absorb_loss(self, loss: float):
        if self.locked_profit >= loss:
            self.locked_profit -= loss
        else:
            remaining = loss - self.locked_profit
            self.locked_profit = 0
            pps_loss = remaining / max(self.total_supply, 1)
            self.total_supply = max(self.total_supply - remaining, 0)

    def _emergency_withdraw(self, shares: float, owner: str) -> float:
        assets = self.convert_to_assets(shares)
        self.total_supply -= shares
        return min(assets, self.total_idle)

    def price_per_share(self) -> float:
        if self.total_supply == 0:
            return 1.0
        return (self.total_idle + self.total_debt) / self.total_supply

    def get_state(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "asset": self.asset,
            "tvl": self.total_idle + self.total_debt,
            "total_supply": self.total_supply,
            "total_idle": self.total_idle,
            "total_debt": self.total_debt,
            "price_per_share": self.price_per_share(),
            "strategy_count": len(self.strategies),
            "paused": self.paused,
            "shutdown": self.shutdown,
        }


class YieldVaultRegistry:
    def __init__(self):
        self.vaults: Dict[str, YieldVault] = {}

    def create_vault(self, name: str, asset: str, deposit_limit: float = float('inf')) -> YieldVault:
        vault = YieldVault(name, asset, deposit_limit)
        self.vaults[vault.id] = vault
        return vault

    def list_vaults(self) -> List[dict]:
        return [v.get_state() for v in self.vaults.values()]
