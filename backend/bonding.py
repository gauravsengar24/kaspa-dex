import time
import json
import os
from typing import Optional

DATA_DIR = os.environ.get("DATA_DIR", "/data")

# Graduation threshold in KAS
GRADUATION_THRESHOLD_KAS = 1000

# Bonding curve formula: linear price increase
# price_kas = BASE_PRICE + (supply / TOTAL_SUPPLY) * PRICE_RANGE
BASE_PRICE_KAS = 0.001
PRICE_RANGE_KAS = 0.009
TOTAL_SUPPLY = 1_000_000_000  # 1B tokens


class BondingToken:
    def __init__(self, ticker: str, name: str, icon: str, creator: str = ""):
        self.ticker = ticker
        self.name = name
        self.icon = icon
        self.creator = creator
        self.supply_sold = 0.0  # tokens sold so far
        self.kas_raised = 0.0  # KAS raised so far
        self.graduated = False
        self.graduated_at: Optional[float] = None
        self.created_at = time.time()
        self.holders: dict[str, float] = {}  # address -> token balance

    @property
    def current_price(self) -> float:
        """Current price in KAS per token (linear bonding curve)."""
        if self.supply_sold >= TOTAL_SUPPLY:
            return BASE_PRICE_KAS + PRICE_RANGE_KAS
        return BASE_PRICE_KAS + (self.supply_sold / TOTAL_SUPPLY) * PRICE_RANGE_KAS

    @property
    def market_cap_kas(self) -> float:
        return self.kas_raised

    @property
    def progress_pct(self) -> float:
        return min(100.0, (self.kas_raised / GRADUATION_THRESHOLD_KAS) * 100)

    def buy(self, kas_amount: float, buyer: str) -> dict:
        if self.graduated:
            return {"error": "Token already graduated, trade on AMM pool"}

        if self.kas_raised + kas_amount > GRADUATION_THRESHOLD_KAS:
            kas_amount = GRADUATION_THRESHOLD_KAS - self.kas_raised
            if kas_amount <= 0:
                return {"error": "Graduation reached, no more bonding curve buys"}

        tokens_bought = self._calc_tokens_for_kas(kas_amount)
        self.supply_sold += tokens_bought
        self.kas_raised += kas_amount
        self.holders[buyer] = self.holders.get(buyer, 0) + tokens_bought

        return {
            "ticker": self.ticker,
            "kas_amount": round(kas_amount, 8),
            "tokens_bought": round(tokens_bought, 2),
            "price_per_token": round(self.current_price, 8),
            "new_supply_sold": round(self.supply_sold, 2),
            "new_kas_raised": round(self.kas_raised, 8),
            "buyer": buyer,
        }

    def sell(self, token_amount: float, seller: str) -> dict:
        if self.graduated:
            return {"error": "Token already graduated, trade on AMM pool"}

        current_balance = self.holders.get(seller, 0)
        if token_amount > current_balance:
            return {"error": f"Insufficient balance. You have {current_balance:.2f}"}

        # Sell at 90% of buy price (slippage)
        # We sell tokens back and price decreases
        # Simulate by estimating KAS return
        kas_return = self._calc_kas_for_tokens(token_amount) * 0.9
        self.supply_sold -= token_amount
        self.kas_raised -= kas_return
        self.holders[seller] = current_balance - token_amount

        return {
            "ticker": self.ticker,
            "kas_returned": round(kas_return, 8),
            "tokens_sold": round(token_amount, 2),
            "price_per_token": round(self.current_price, 8),
            "seller": seller,
        }

    def _calc_tokens_for_kas(self, kas_amount: float) -> float:
        tokens = 0.0
        remaining = kas_amount
        temp_supply = self.supply_sold
        while remaining > 0 and temp_supply < TOTAL_SUPPLY:
            price = BASE_PRICE_KAS + (temp_supply / TOTAL_SUPPLY) * PRICE_RANGE_KAS
            # How many tokens at this price point?
            step = min(remaining / price, TOTAL_SUPPLY - temp_supply)
            tokens += step
            remaining -= step * price
            temp_supply += step
        return tokens

    def _calc_kas_for_tokens(self, token_amount: float) -> float:
        kas = 0.0
        remaining = token_amount
        temp_supply = self.supply_sold
        while remaining > 0 and temp_supply > 0:
            price = BASE_PRICE_KAS + (temp_supply / TOTAL_SUPPLY) * PRICE_RANGE_KAS
            step = min(remaining, temp_supply)
            kas += step * price
            remaining -= step
            temp_supply -= step
        return kas

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "name": self.name,
            "icon": self.icon,
            "creator": self.creator,
            "supplySold": round(self.supply_sold, 2),
            "kasRaised": round(self.kas_raised, 8),
            "currentPrice": round(self.current_price, 8),
            "marketCapKas": round(self.market_cap_kas, 8),
            "progressPct": round(self.progress_pct, 2),
            "graduated": self.graduated,
            "graduatedAt": self.graduated_at,
            "createdAt": self.created_at,
            "totalSupply": TOTAL_SUPPLY,
            "graduationThreshold": GRADUATION_THRESHOLD_KAS,
        }


class BondingCurveRegistry:
    def __init__(self):
        self.tokens: dict[str, BondingToken] = {}
        self._load()

    def create_token(self, ticker: str, name: str, icon: str, creator: str = "") -> BondingToken:
        if ticker in self.tokens:
            raise ValueError(f"Token {ticker} already exists")
        token = BondingToken(ticker, name, icon, creator)
        self.tokens[ticker] = token
        self._save()
        return token

    def get_token(self, ticker: str) -> Optional[BondingToken]:
        return self.tokens.get(ticker)

    def list_tokens(self, graduated: Optional[bool] = None) -> list[dict]:
        result = []
        for t in self.tokens.values():
            if graduated is None or t.graduated == graduated:
                result.append(t.to_dict())
        return result

    def check_graduation(self, ticker: str) -> Optional[dict]:
        token = self.tokens.get(ticker)
        if not token or token.graduated:
            return None
        if token.kas_raised >= GRADUATION_THRESHOLD_KAS:
            token.graduated = True
            token.graduated_at = time.time()
            self._save()
            return {
                "ticker": ticker,
                "graduated": True,
                "kasRaised": token.kas_raised,
                "supplySold": token.supply_sold,
                "graduatedAt": token.graduated_at,
            }
        return None

    def _path(self):
        return os.path.join(DATA_DIR, "bonding_tokens.json")

    def _save(self):
        path = self._path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = {}
        for ticker, token in self.tokens.items():
            d = token.to_dict()
            d["holders"] = token.holders
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
                token = BondingToken(d["ticker"], d.get("name", ""), d.get("icon", ""), d.get("creator", ""))
                token.supply_sold = d.get("supplySold", 0)
                token.kas_raised = d.get("kasRaised", 0)
                token.graduated = d.get("graduated", False)
                token.graduated_at = d.get("graduatedAt")
                token.created_at = d.get("createdAt", time.time())
                token.holders = d.get("holders", {})
                self.tokens[ticker] = token
        except (json.JSONDecodeError, KeyError):
            pass


bonding_registry = BondingCurveRegistry()
