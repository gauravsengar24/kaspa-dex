from typing import Dict, List, Optional
import uuid


class GaugeVote:
    def __init__(self, voter: str, gauge_id: str, weight_bps: int):
        self.voter = voter
        self.gauge_id = gauge_id
        self.weight_bps = weight_bps


class LiquidityGauge:
    def __init__(self, pool_id: str, name: str, pool_type: str = "CPMM"):
        self.id = str(uuid.uuid4())
        self.pool_id = pool_id
        self.name = name
        self.pool_type = pool_type
        self.total_weight = 0.0
        self.type_weight = 1.0  # weight for this gauge type
        self.relative_weight = 0.0


class GaugeController:
    """Gauge reward distribution controller (Curve)"""

    def __init__(self):
        self.gauges: Dict[str, LiquidityGauge] = {}
        self.votes: Dict[str, GaugeVote] = {}
        self.gauge_types = {
            "CPMM": 1.0,
            "CLMM": 1.0,
            "STABLE": 1.0,
            "WEIGHTED": 1.0,
            "LENDING": 0.5,
            "YIELD": 0.5,
        }

    def add_gauge(self, pool_id: str, name: str, pool_type: str = "CPMM") -> LiquidityGauge:
        gauge = LiquidityGauge(pool_id, name, pool_type)
        gauge.type_weight = self.gauge_types.get(pool_type, 1.0)
        self.gauges[gauge.id] = gauge
        return gauge

    def vote(self, voter: str, gauge_id: str, weight_bps: int):
        if gauge_id not in self.gauges:
            raise ValueError("Gauge not found")
        weight_bps = max(0, min(weight_bps, 10000))
        self.votes[f"{voter}:{gauge_id}"] = GaugeVote(voter, gauge_id, weight_bps)

    def update_weights(self):
        total_type_weight = sum(self.gauge_types.values())
        for gauge in self.gauges.values():
            gauge_votes = sum(
                v.weight_bps for k, v in self.votes.items()
                if v.gauge_id == gauge.id
            )
            gauge.total_weight = gauge_votes
            type_weight = gauge.type_weight / total_type_weight if total_type_weight > 0 else 0
            gauge.relative_weight = type_weight * (gauge_votes / max(sum(
                v.weight_bps for k, v in self.votes.items()
                if self.gauges.get(v.gauge_id) and self.gauges[v.gauge_id].pool_type == gauge.pool_type
            ), 1))

    def get_reward_rates(self) -> Dict[str, float]:
        self.update_weights()
        total_rewards = 10000  # total reward units per period
        return {
            g.id: g.relative_weight * total_rewards
            for g in self.gauges.values()
        }

    def get_boost(self, user_ve_balance: float, total_ve_supply: float,
                  user_lp_balance: float, total_lp_supply: float) -> float:
        if total_lp_supply == 0 or total_ve_supply == 0:
            return 1.0
        working = user_lp_balance * 0.4 + total_lp_supply * (user_ve_balance / total_ve_supply) * 0.6
        min_working = user_lp_balance * 0.4
        unboosted = user_lp_balance
        ratio = working / unboosted if unboosted > 0 else 1.0
        return min(2.5, ratio)
