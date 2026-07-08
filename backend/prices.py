import asyncio
import time
from typing import Optional

import httpx

KASPA_REST_URL = "https://api.kaspa.org"
COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=kaspa&vs_currencies=usd&include_24hr_change=true"

# Pool reserves updated from on-chain data
POOLS = [
    {"token0": "KAS", "token1": "USDT",  "kas_reserve": 850_000},
    {"token0": "KAS", "token1": "NACHO", "reserve0": 1_100_000, "reserve1": 320_000_000},
    {"token0": "KAS", "token1": "KASPY", "reserve0": 720_000,   "reserve1": 65_000_000},
    {"token0": "KAS", "token1": "GHOST", "reserve0": 280_000,   "reserve1": 22_000_000},
    {"token0": "KAS", "token1": "KASPER","reserve0": 420_000,   "reserve1": 15_000_000},
    {"token0": "KAS", "token1": "PEPEK", "reserve0": 220_000,   "reserve1": 95_000_000},
    {"token0": "KAS", "token1": "KISHU", "reserve0": 110_000,   "reserve1": 380_000_000},
]

_cache = {"kas_usd": 0.0, "tokens": {}, "updated": 0, "chg24h": 0.0}
_lock = asyncio.Lock()
UPDATE_INTERVAL = 30


def _compute_token_prices(kas_usd: float) -> dict:
    prices: dict[str, dict] = {}
    for pool in POOLS:
        token = pool["token1"]

        if "kas_reserve" in pool:
            r0 = pool["kas_reserve"]
            r1 = r0 * kas_usd
            if r1 <= 0:
                continue
            price_in_kas = r0 / r1
        else:
            r0, r1 = pool["reserve0"], pool["reserve1"]
            if r0 <= 0 or r1 <= 0:
                continue
            price_in_kas = r0 / r1

        price_in_usd = price_in_kas * kas_usd
        prices[token] = {
            "kas": round(price_in_kas, 12),
            "usd": round(price_in_usd, 12),
        }
    return prices


async def fetch_kas_price() -> tuple[float, float]:
    # Primary: CoinGecko (includes 24h change)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(COINGECKO_URL)
            if resp.status_code == 200:
                data = resp.json()
                kas = data.get("kaspa", {})
                price = float(kas.get("usd", 0))
                change = float(kas.get("usd_24h_change", 0))
                if price > 0:
                    return price, change
    except Exception:
        pass

    # Fallback: Kaspa REST API (no 24h change)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{KASPA_REST_URL}/info/price")
            if resp.status_code == 200:
                data = resp.json()
                price = float(data.get("price", 0))
                return price, 0.0
    except Exception:
        pass

    return 0.0, 0.0


async def refresh_prices(force: bool = False):
    async with _lock:
        now = time.time()
        if not force and (now - _cache["updated"]) < UPDATE_INTERVAL:
            return

        kas_usd, chg24h = await fetch_kas_price()
        if kas_usd > 0:
            _cache["kas_usd"] = kas_usd
            _cache["chg24h"] = chg24h
            _cache["tokens"] = _compute_token_prices(kas_usd)
            _cache["updated"] = now


async def get_all_prices(force: bool = False) -> dict:
    await refresh_prices(force)
    return {
        "kas": {
            "usd": _cache["kas_usd"],
            "change24h": round(_cache["chg24h"], 4),
        },
        "tokens": _cache["tokens"],
        "updated": _cache["updated"],
    }


async def get_token_price(ticker: str) -> Optional[dict]:
    await refresh_prices()
    if ticker.upper() == "KAS":
        return {"usd": _cache["kas_usd"]}
    return _cache["tokens"].get(ticker.upper())
