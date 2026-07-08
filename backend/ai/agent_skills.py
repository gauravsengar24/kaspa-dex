import json
from typing import Dict, Any, Optional


class AgentSkill:
    """AI agent skill — natural language to protocol actions (PancakeSwap AI)"""

    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description

    def get_openapi_spec(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {},
        }

    def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


class SwapSkill(AgentSkill):
    def __init__(self, router):
        super().__init__("swap", "Execute token swaps across all pool types")
        self.router = router

    def get_openapi_spec(self) -> dict:
        return {
            "name": "swap",
            "description": "Swap tokens using the best available route",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_token": {"type": "string"},
                    "to_token": {"type": "string"},
                    "amount": {"type": "number"},
                    "slippage": {"type": "number", "default": 0.5},
                },
                "required": ["from_token", "to_token", "amount"],
            },
        }

    def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "action": "swap",
            "from": params.get("from_token"),
            "to": params.get("to_token"),
            "amount": params.get("amount"),
            "route": None,
            "status": "planned",
        }


class LiquiditySkill(AgentSkill):
    def __init__(self, amm_engine):
        super().__init__("liquidity", "Manage liquidity positions across pool types")
        self.amm = amm_engine

    def get_openapi_spec(self) -> dict:
        return {
            "name": "liquidity",
            "description": "Add or remove liquidity from pools",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["add", "remove"]},
                    "pool_id": {"type": "string"},
                    "amount0": {"type": "number"},
                    "amount1": {"type": "number"},
                },
                "required": ["action", "pool_id"],
            },
        }

    def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return {"action": params.get("action"), "pool": params.get("pool_id"), "status": "simulated"}


class YieldSkill(AgentSkill):
    def __init__(self, vault_registry):
        super().__init__("yield", "Manage yield vault deposits and withdrawals")
        self.vaults = vault_registry

    def get_openapi_spec(self) -> dict:
        return {
            "name": "yield",
            "description": "Deposit or withdraw from yield vaults",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["deposit", "withdraw"]},
                    "vault_id": {"type": "string"},
                    "amount": {"type": "number"},
                },
            },
        }

    def execute(self, params: Dict[str, Any]) -> Dict[str, Any]:
        return {"action": params.get("action"), "vault": params.get("vault_id"), "status": "simulated"}


class SkillRegistry:
    def __init__(self):
        self.skills: Dict[str, AgentSkill] = {}

    def register(self, skill: AgentSkill):
        self.skills[skill.name] = skill

    def get_openapi_spec(self) -> dict:
        return {
            "openapi": "3.1.0",
            "info": {"title": "KaspaSwap AI Plugin", "version": "1.0.0"},
            "servers": [{"url": "https://kaspadex-swap.hf.space"}],
            "paths": {},
            "x-skills": {name: s.get_openapi_spec() for name, s in self.skills.items()},
        }

    def execute(self, skill_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if skill_name not in self.skills:
            raise ValueError(f"Unknown skill: {skill_name}")
        return self.skills[skill_name].execute(params)
