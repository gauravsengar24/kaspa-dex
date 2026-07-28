import json
import asyncio
from typing import Optional

import httpx

KASPA_REST_URL = "https://api.kaspa.org"
KASPLEX_API_URL = "https://api.kasplex.org/v1"


class KaspaNodeClient:
    def __init__(self, rest_url: str = KASPA_REST_URL):
        self.rest_url = rest_url

    async def check_health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.rest_url}/info/health")
                return resp.status_code == 200
        except Exception:
            return False

    async def get_balance(self, address: str) -> float:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{self.rest_url}/addresses/{address}/balance")
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("balance", 0) / 1e8
        except Exception:
            pass
        return 0.0

    async def broadcast_transaction(self, tx_json: str) -> Optional[str]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "submitTransaction",
                    "params": {"transaction": json.loads(tx_json)},
                }
                resp = await client.post(
                    f"{self.rest_url}/api/submit-transaction",
                    json=payload,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("result", {}).get("txid")
        except Exception as e:
            print(f"Broadcast error: {e}")
        return None

    async def get_transaction_status(self, tx_id: str) -> Optional[dict]:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{self.rest_url}/transactions/{tx_id}")
                if resp.status_code == 200:
                    return resp.json()
        except Exception:
            pass
        return None

    async def get_utxos(self, address: str) -> list[dict]:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{self.rest_url}/addresses/{address}/utxos")
                if resp.status_code == 200:
                    return resp.json()
        except Exception:
            pass
        return []


node_client = KaspaNodeClient()
