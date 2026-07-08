import time
import math
from typing import Dict, Optional

MAX_TIME = 4 * 365 * 86400  # 4 years
WEEK = 7 * 86400


class LockedBalance:
    def __init__(self, amount: float, end: float):
        self.amount = amount
        self.end = end


class Point:
    def __init__(self, bias: float = 0.0, slope: float = 0.0, ts: float = 0.0):
        self.bias = bias
        self.slope = slope
        self.ts = ts


class VEKaspa:
    """Vote-Escrowed KASPA (Curve veCRV) — slope/bias model"""

    def __init__(self):
        self.token = "KASPA"
        self.total_supply = 0.0
        self.locked: Dict[str, LockedBalance] = {}
        self.user_point_history: Dict[str, list] = {}
        self.point_history: list = [Point(0, 0, time.time())]
        self.epoch = 0
        self.slope_changes: Dict[float, float] = {}

    def create_lock(self, user: str, amount: float, unlock_time: float):
        if user in self.locked:
            raise ValueError("Already locked")
        unlock_time = round(unlock_time / WEEK) * WEEK + WEEK  # round to week
        if unlock_time <= time.time():
            raise ValueError("Unlock time must be in future")
        if unlock_time > time.time() + MAX_TIME:
            unlock_time = time.time() + MAX_TIME

        self.locked[user] = LockedBalance(amount, unlock_time)
        self._checkpoint(user, amount, unlock_time)

    def increase_amount(self, user: str, additional: float):
        if user not in self.locked:
            raise ValueError("No existing lock")
        lock = self.locked[user]
        lock.amount += additional
        self._checkpoint(user, additional, lock.end)

    def increase_unlock_time(self, user: str, new_unlock_time: float):
        if user not in self.locked:
            raise ValueError("No existing lock")
        lock = self.locked[user]
        new_unlock_time = round(new_unlock_time / WEEK) * WEEK + WEEK
        if new_unlock_time <= lock.end:
            raise ValueError("Cannot shorten lock time")
        if new_unlock_time > time.time() + MAX_TIME:
            new_unlock_time = time.time() + MAX_TIME
        lock.end = new_unlock_time
        self._checkpoint(user, 0, new_unlock_time)

    def withdraw(self, user: str) -> float:
        if user not in self.locked:
            raise ValueError("No lock")
        lock = self.locked[user]
        if time.time() < lock.end:
            raise ValueError("Lock still active")
        amount = lock.amount
        del self.locked[user]
        self.total_supply -= amount
        return amount

    def get_voting_power(self, user: str, at_time: Optional[float] = None) -> float:
        if user not in self.locked:
            return 0.0
        if at_time is None:
            at_time = time.time()
        lock = self.locked[user]
        if at_time >= lock.end:
            return 0.0
        remaining = lock.end - at_time
        return lock.amount * remaining / MAX_TIME

    def _checkpoint(self, user: str, amount: float, unlock_time: float):
        now = time.time()
        old_slope = 0.0
        old_bias = 0.0

        if user in self.user_point_history and self.user_point_history[user]:
            last = self.user_point_history[user][-1]
            old_slope = last.slope
            old_bias = last.bias

        new_slope = amount / MAX_TIME
        new_bias = new_slope * (unlock_time - now)

        self.total_supply += amount

        pt = Point(new_bias, new_slope, now)
        if user not in self.user_point_history:
            self.user_point_history[user] = []
        self.user_point_history[user].append(pt)
        self.epoch += 1
        self.point_history.append(pt)

        # Track slope changes at week boundaries
        week_ts = round(now / WEEK) * WEEK + WEEK
        while week_ts <= unlock_time:
            self.slope_changes[week_ts] = self.slope_changes.get(week_ts, 0) + new_slope
            week_ts += WEEK

    def total_supply_at(self, t: Optional[float] = None) -> float:
        if t is None:
            t = time.time()
        return sum(self.get_voting_power(u, t) for u in self.locked)
