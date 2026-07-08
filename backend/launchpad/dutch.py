import time
import uuid


class DutchAuction:
    """Dutch auction — price decreases over time (MISO/Sushi)"""

    def __init__(self, token: str, token_amount: float, base_token: str = "KAS",
                 start_price: float = 1.0, end_price: float = 0.1,
                 duration_hours: float = 24):
        self.id = str(uuid.uuid4())
        self.token = token
        self.token_amount = token_amount
        self.base_token = base_token
        self.start_price = start_price
        self.end_price = end_price
        self.start_time = time.time() + 3600
        self.end_time = self.start_time + duration_hours * 3600
        self.tokens_sold = 0.0
        self.base_raised = 0.0

    def current_price(self) -> float:
        now = time.time()
        if now <= self.start_time:
            return self.start_price
        if now >= self.end_time:
            return self.end_price
        elapsed = (now - self.start_time) / (self.end_time - self.start_time)
        return self.start_price - (self.start_price - self.end_price) * elapsed

    def buy(self, amount_base: float) -> float:
        price = self.current_price()
        tokens_for_base = amount_base / price
        available = self.token_amount - self.tokens_sold
        tokens = min(tokens_for_base, available)
        self.tokens_sold += tokens
        self.base_raised += amount_base
        return tokens

    def get_state(self) -> dict:
        return {
            "id": self.id,
            "token": self.token,
            "price": self.current_price(),
            "tokens_sold": self.tokens_sold,
            "tokens_remaining": self.token_amount - self.tokens_sold,
            "progress": round(self.tokens_sold / self.token_amount * 100, 2) if self.token_amount > 0 else 0,
            "base_raised": self.base_raised,
        }
