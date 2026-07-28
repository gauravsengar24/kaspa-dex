import time
import json
import os
from typing import Optional

from backend.amm.cpmm import CPMMPool

DATA_DIR = os.environ.get("DATA_DIR", "/data")
POOL_FEE = 0.003  # 0.3%


class LockedLiquidityPool:
    """CPMM pool with permanently locked graduation liquidity."""

    def __init__(self, ticker: str, locked_kas: float, locked_tokens: float):
        self.ticker = ticker
        self.pool = CPMMPool(locked_kas, locked_tokens, POOL_FEE)
        self.locked_kas = locked_kas
        self.locked_tokens = locked_tokens
        self.total_lp_shares = 1000.0  # initial shares for locked liquidity
        self.lp_holders: dict[str, float] = {}  # address -> lp shares
        self.graduated_at = time.time()

    @property
    def is_locked(self) -> bool:
        return True

    def swap_kas_for_tokens(self, kas_amount: float, user: str) -> dict:
        if self.pool.reserve0 <= 0:
            return {"error": "Pool has no KAS reserves"}
        tokens_out = self.pool.swap_out_given_in(kas_amount, token_in_is_0=True)
        return {
            "ticker": self.ticker,
            "kas_in": round(kas_amount, 8),
            "tokens_out": round(tokens_out, 2),
            "new_kas_reserve": round(self.pool.reserve0, 8),
            "new_token_reserve": round(self.pool.reserve1, 2),
            "user": user,
        }

    def swap_tokens_for_kas(self, token_amount: float, user: str) -> dict:
        if self.pool.reserve1 <= 0:
            return {"error": "Pool has no token reserves"}
        kas_out = self.pool.swap_out_given_in(token_amount, token_in_is_0=False)
        return {
            "ticker": self.ticker,
            "tokens_in": round(token_amount, 2),
            "kas_out": round(kas_out, 8),
            "new_kas_reserve": round(self.pool.reserve0, 8),
            "new_token_reserve": round(self.pool.reserve1, 2),
            "user": user,
        }

    def add_liquidity(self, kas_amount: float, token_amount: float, user: str) -> dict:
        actual_kas, actual_tokens, shares = self.pool.add_liquidity(kas_amount, token_amount)
        self.lp_holders[user] = self.lp_holders.get(user, 0) + shares
        self.total_lp_shares += shares
        return {
            "ticker": self.ticker,
            "kas_added": round(actual_kas, 8),
            "tokens_added": round(actual_tokens, 2),
            "lp_shares": round(shares, 6),
            "total_lp_shares": round(self.total_lp_shares, 6),
            "user": user,
        }

    def remove_liquidity(self, shares: float, user: str) -> dict:
        current_shares = self.lp_holders.get(user, 0)
        if shares > current_shares:
            return {"error": f"Insufficient LP shares. You have {current_shares:.6f}"}

        # Can't remove locked liquidity
        user_pool_share = shares / self.total_lp_shares
        total_kas = self.pool.reserve0
        total_tokens = self.pool.reserve1

        # Only the user's portion that's not locked
        user_lock_share = self.locked_kas / total_kas if total_kas > 0 else 0
        user_own_kas_share = (shares / self.total_lp_shares) * total_kas
        user_own_token_share = (shares / self.total_lp_shares) * total_tokens

        # Ensure we don't remove locked liquidity
        if self.pool.reserve0 - user_own_kas_share < self.locked_kas:
            user_own_kas_share = self.pool.reserve0 - self.locked_kas
            user_own_token_share = self.pool.reserve1 - self.locked_tokens
            if user_own_kas_share <= 0 or user_own_token_share <= 0:
                return {"error": "Cannot remove - only locked liquidity remains"}

        actual_kas, actual_tokens = self.pool.remove_liquidity(shares / self.total_lp_shares)
        self.lp_holders[user] = current_shares - shares
        self.total_lp_shares -= shares

        return {
            "ticker": self.ticker,
            "kas_removed": round(actual_kas, 8),
            "tokens_removed": round(actual_tokens, 2),
            "lp_shares_burned": round(shares, 6),
            "remaining_lp": round(self.lp_holders.get(user, 0), 6),
            "user": user,
        }

    def get_user_lp(self, user: str) -> float:
        return self.lp_holders.get(user, 0)

    def quote_swap(self, kas_amount: float, token_amount: float = 0) -> dict:
        if kas_amount > 0:
            tokens_out = self.pool.get_output_estimate(kas_amount, token_in_is_0=True)
            return {
                "kas_in": kas_amount,
                "tokens_out": round(tokens_out, 2),
                "price": round(kas_amount / tokens_out, 8) if tokens_out > 0 else 0,
            }
        if token_amount > 0:
            kas_out = self.pool.get_output_estimate(token_amount, token_in_is_0=False)
            return {
                "tokens_in": token_amount,
                "kas_out": round(kas_out, 8),
                "price": round(token_amount / kas_out, 2) if kas_out > 0 else 0,
            }
        return {}

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "kasReserve": round(self.pool.reserve0, 8),
            "tokenReserve": round(self.pool.reserve1, 2),
            "lockedKas": round(self.locked_kas, 8),
            "lockedTokens": round(self.locked_tokens, 2),
            "price": round(self.pool.get_price(), 8),
            "fee": POOL_FEE,
            "totalLpShares": round(self.total_lp_shares, 6),
            "graduatedAt": self.graduated_at,
            "k": self.pool.k,
        }


class LiquidityPoolRegistry:
    def __init__(self):
        self.pools: dict[str, LockedLiquidityPool] = {}
        self._load()

    def create_pool(self, ticker: str, locked_kas: float, locked_tokens: float) -> LockedLiquidityPool:
        pool = LockedLiquidityPool(ticker, locked_kas, locked_tokens)
        self.pools[ticker] = pool
        self._save()
        return pool

    def get_pool(self, ticker: str) -> Optional[LockedLiquidityPool]:
        return self.pools.get(ticker)

    def list_pools(self) -> list[dict]:
        return [p.to_dict() for p in self.pools.values()]

    def _path(self):
        return os.path.join(DATA_DIR, "liquidity_pools.json")

    def _save(self):
        path = self._path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = {}
        for ticker, pool in self.pools.items():
            d = pool.to_dict()
            d["lp_holders"] = pool.lp_holders
            data[ticker] = d
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    def _load(self):
        path = self._path()
        if not os.path.exists(path):
            return
        try:
            with open(path) as f:
                data = json.load(f)
            for ticker, d in data.items():
                pool = LockedLiquidityPool(
                    ticker,
                    d.get("lockedKas", 0),
                    d.get("lockedTokens", 0),
                )
                pool.total_lp_shares = d.get("totalLpShares", 1000.0)
                pool.lp_holders = d.get("lp_holders", {})
                pool.pool.reserve0 = d.get("kasReserve", d.get("lockedKas", 0))
                pool.pool.reserve1 = d.get("tokenReserve", d.get("lockedTokens", 0))
                pool.pool.k = pool.pool.reserve0 * pool.pool.reserve1
                pool.graduated_at = d.get("graduatedAt", time.time())
                self.pools[ticker] = pool
        except (json.JSONDecodeError, KeyError):
            pass


liquidity_registry = LiquidityPoolRegistry()
