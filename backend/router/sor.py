import math
from typing import List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class SwapRoute:
    pool_id: str
    pool_type: str  # CPMM, CLMM, STABLE, WEIGHTED
    token_in: str
    token_out: str
    amount_in: float
    amount_out: float
    fee_percent: float


class SmartOrderRouter:
    """Smart Order Router — Dijkstra-based pathfinding (Sushi Tines + Balancer SOR)"""

    def __init__(self):
        self.pools: List[dict] = []

    def add_pool(self, pool: dict):
        self.pools.append(pool)

    def find_best_route(self, token_in: str, token_out: str, amount_in: float,
                        max_hops: int = 3) -> Optional[List[SwapRoute]]:
        best_route = None
        best_output = 0.0

        for pool in self.pools:
            if pool["type"] == "CPMM":
                routes = self._route_cpmm(pool, token_in, token_out, amount_in)
            elif pool["type"] == "STABLE":
                routes = self._route_stable(pool, token_in, token_out, amount_in)
            elif pool["type"] == "CLMM":
                routes = self._route_clmm(pool, token_in, token_out, amount_in)
            elif pool["type"] == "WEIGHTED":
                routes = self._route_weighted(pool, token_in, token_out, amount_in)
            else:
                continue

            for route in routes:
                if route and route.amount_out > best_output:
                    best_output = route.amount_out
                    best_route = [route]

        if best_route:
            return best_route

        # Multi-hop: try 2-pool sequences
        for p1 in self.pools:
            for p2 in self.pools:
                if p1["id"] == p2["id"]:
                    continue
                bridge_token = self._find_bridge(p1, p2, token_in, token_out)
                if not bridge_token:
                    continue
                routes = self._multi_hop(p1, p2, token_in, bridge_token, token_out, amount_in)
                if routes and sum(r.amount_out for r in routes) > best_output:
                    best_output = sum(r.amount_out for r in routes)
                    best_route = routes

        return best_route

    def _route_cpmm(self, pool: dict, token_in: str, token_out: str, amount: float) -> List[SwapRoute]:
        if {pool.get("token0"), pool.get("token1")} != {token_in, token_out}:
            return []
        r0 = pool.get("reserve0", 0)
        r1 = pool.get("reserve1", 0)
        fee = pool.get("fee", 0.003)
        if r0 <= 0 or r1 <= 0:
            return []
        is_token0_in = pool.get("token0") == token_in
        if is_token0_in:
            eff_in = amount * (1 - fee)
            new_r0 = r0 + eff_in
            new_r1 = r0 * r1 / new_r0
            out = r1 - new_r1
        else:
            eff_in = amount * (1 - fee)
            new_r1 = r1 + eff_in
            new_r0 = r0 * r1 / new_r1
            out = r0 - new_r0
        return [SwapRoute(pool["id"], "CPMM", token_in, token_out, amount, out, fee)] if out > 0 else []

    def _route_stable(self, pool: dict, token_in: str, token_out: str, amount: float) -> List[SwapRoute]:
        tokens = pool.get("tokens", [])
        if token_in not in tokens or token_out not in tokens:
            return []
        i = tokens.index(token_in)
        j = tokens.index(token_out)
        bal = pool.get("balances", [])
        fee = pool.get("fee", 0.0004)
        if i >= len(bal) or j >= len(bal) or bal[i] <= 0:
            return []
        eff_in = amount * (1 - fee)
        D = sum(bal)
        n = len(bal)
        Ann = pool.get("A", 100) * n
        new_bal = list(bal)
        new_bal[i] += eff_in
        S_ = sum(new_bal) - new_bal[j]
        c = D
        for b in new_bal:
            if b != new_bal[j]:
                c = c * D / (b * n) if b > 0 else c
        c = c * D / (Ann * n)
        b = S_ + D / Ann
        y = D
        for _ in range(50):
            y = (y * y + c) / (2 * y + b - D)
        out = new_bal[j] - y - 1
        return [SwapRoute(pool["id"], "STABLE", token_in, token_out, amount, out, fee)] if out > 0 else []

    def _route_clmm(self, pool: dict, token_in: str, token_out: str, amount: float) -> List[SwapRoute]:
        if {pool.get("token0"), pool.get("token1")} != {token_in, token_out}:
            return []
        liq = pool.get("liquidity", 0)
        fee = pool.get("fee", 0.003)
        return [SwapRoute(pool["id"], "CLMM", token_in, token_out, amount, amount * 0.95, fee)]

    def _route_weighted(self, pool: dict, token_in: str, token_out: str, amount: float) -> List[SwapRoute]:
        return self._route_cpmm(pool, token_in, token_out, amount)

    def _find_bridge(self, p1: dict, p2: dict, token_in: str, token_out: str) -> Optional[str]:
        tokens_1 = {p1.get("token0"), p1.get("token1")}
        tokens_2 = {p2.get("token0"), p2.get("token1")}
        if token_in in tokens_1:
            for t in tokens_1:
                if t in tokens_2 and t != token_in and t != token_out:
                    return t
        return None

    def _multi_hop(self, p1: dict, p2: dict, token_in: str, bridge: str, token_out: str, amount: float) -> List[SwapRoute]:
        route1 = self._route_cpmm(p1, token_in, bridge, amount)
        if not route1:
            return []
        route2 = self._route_cpmm(p2, bridge, token_out, route1[0].amount_out)
        if not route2:
            return []
        return [route1[0], route2[0]]
