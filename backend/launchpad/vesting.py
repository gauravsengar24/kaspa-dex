import time
import uuid
from typing import List


class VestingSchedule:
    def __init__(self, token: str, total_amount: float, recipient: str,
                 cliff_days: int = 30, duration_days: int = 180):
        self.id = str(uuid.uuid4())
        self.token = token
        self.total_amount = total_amount
        self.recipient = recipient
        self.start_time = time.time()
        self.cliff_time = self.start_time + cliff_days * 86400
        self.end_time = self.start_time + duration_days * 86400
        self.claimed = 0.0

    def vested_amount(self) -> float:
        now = time.time()
        if now < self.cliff_time:
            return 0.0
        if now >= self.end_time:
            return self.total_amount
        elapsed = (now - self.cliff_time) / (self.end_time - self.cliff_time)
        return self.total_amount * elapsed

    def claimable(self) -> float:
        return self.vested_amount() - self.claimed

    def claim(self) -> float:
        amount = self.claimable()
        self.claimed += amount
        return amount


class TokenVesting:
    def __init__(self):
        self.schedules: List[VestingSchedule] = []

    def create_schedule(self, token: str, amount: float, recipient: str,
                        cliff_days: int = 30, duration_days: int = 180) -> str:
        vs = VestingSchedule(token, amount, recipient, cliff_days, duration_days)
        self.schedules.append(vs)
        return vs.id
