import time
import uuid
from enum import IntEnum
from typing import List, Optional, Any


class Command(IntEnum):
    SWAP_EXACT_IN = 0
    SWAP_EXACT_OUT = 1
    PERMIT2_TRANSFER_FROM = 2
    PERMIT2_PERMIT_BATCH = 3
    SWEEP = 4
    TRANSFER = 5
    PAY_PORTION = 6
    WRAP_KAS = 7
    UNWRAP_KAS = 8
    EXECUTE_SUB_PLAN = 9
    V2_SWAP_EXACT_IN = 10
    V2_SWAP_EXACT_OUT = 11
    CLMM_SWAP = 12
    STABLE_SWAP = 13
    WEIGHTED_SWAP = 14
    LEND_SUPPLY = 15
    LEND_BORROW = 16
    LEND_REPAY = 17
    YIELD_DEPOSIT = 18
    YIELD_WITHDRAW = 19
    PREDICT_BET = 20
    GOV_LOCK = 21
    GOV_VOTE = 22


class CommandInput:
    def __init__(self, command: Command, data: Any, allow_revert: bool = False):
        self.command = command
        self.data = data
        self.allow_revert = allow_revert


class ExecutionPlan:
    def __init__(self, deadline: Optional[float] = None):
        self.id = str(uuid.uuid4())
        self.commands: List[CommandInput] = []
        self.deadline = deadline or (time.time() + 3600)

    def add(self, command: Command, data: Any, allow_revert: bool = False):
        self.commands.append(CommandInput(command, data, allow_revert))


class UniversalRouter:
    """Single entry point for ALL protocol operations (Uniswap Universal Router)"""

    def __init__(self):
        self.routers = {}  # protocol-specific handlers

    def register_handler(self, command: Command, handler: callable):
        self.routers[command] = handler

    def execute(self, plan: ExecutionPlan) -> List[Any]:
        if time.time() > plan.deadline:
            raise ValueError("Transaction expired")
        results = []
        for cmd in plan.commands:
            handler = self.routers.get(cmd.command)
            if not handler:
                if cmd.allow_revert:
                    results.append(None)
                    continue
                raise ValueError(f"No handler for command {cmd.command}")
            try:
                result = handler(cmd.data)
                results.append(result)
            except Exception as e:
                if cmd.allow_revert:
                    results.append(None)
                else:
                    raise e
        return results
