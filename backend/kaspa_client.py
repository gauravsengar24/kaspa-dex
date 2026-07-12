import json
import asyncio
from typing import Optional

import httpx

KASPA_RPC_URL = "ws://testnet-12.kaspa.org:17210"
KASPA_REST_URL = "https://api-tn12.kaspa.org"


class KaspaNodeClient:
    def __init__(self, rpc_url: str = KASPA_RPC_URL):
        self.rpc_url = rpc_url
        self._connected = False

    async def check_health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{KASPA_REST_URL}/info/health")
                return resp.status_code == 200
        except Exception:
            return False

    async def get_balance(self, address: str) -> float:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{KASPA_REST_URL}/addresses/{address}/balance"
                )
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
                    f"{KASPA_REST_URL}/api/submit-transaction",
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
                resp = await client.get(
                    f"{KASPA_REST_URL}/transactions/{tx_id}"
                )
                if resp.status_code == 200:
                    return resp.json()
        except Exception:
            pass
        return None


node_client = KaspaNodeClient()
