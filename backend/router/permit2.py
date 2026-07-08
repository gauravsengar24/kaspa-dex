import time
import uuid
from typing import Dict, Optional


class Permit2:
    """Unified token approval system (Uniswap Permit2)"""

    def __init__(self):
        self.allowances: Dict[str, dict] = {}  # key: owner:spender:token
        self.nonces: Dict[str, int] = {}

    def approve(self, owner: str, spender: str, token: str, amount: float, expiration: Optional[float] = None):
        key = f"{owner}:{spender}:{token}"
        self.allowances[key] = {
            "amount": amount,
            "expiration": expiration or (time.time() + 86400 * 30),
            "nonce": self._next_nonce(owner),
        }

    def transfer_from(self, owner: str, spender: str, token: str, amount: float, recipient: str) -> float:
        key = f"{owner}:{spender}:{token}"
        if key not in self.allowances:
            raise ValueError("No allowance")
        allow = self.allowances[key]
        if time.time() > allow["expiration"]:
            raise ValueError("Allowance expired")
        transferred = min(amount, allow["amount"])
        allow["amount"] -= transferred
        return transferred

    def signature_transfer(self, owner: str, spender: str, token: str, amount: float,
                           recipient: str, signature: str, nonce: int) -> float:
        expected_nonce = self._next_nonce(owner)
        self.nonces[owner] = nonce + 1
        return self.transfer_from(owner, spender, token, amount, recipient)

    def lockdown(self, owner: str):
        """Batch revoke all approvals for an owner"""
        keys_to_remove = [k for k in self.allowances if k.startswith(f"{owner}:")]
        for k in keys_to_remove:
            del self.allowances[k]

    def _next_nonce(self, owner: str) -> int:
        nonce = self.nonces.get(owner, 0)
        self.nonces[owner] = nonce + 1
        return nonce
