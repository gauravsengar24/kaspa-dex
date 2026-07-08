import uuid
import time
from typing import Dict, Optional, List
from enum import Enum


class AchievementType(Enum):
    TRADE_VOLUME = "trade_volume"
    LP_DURATION = "lp_duration"
    PREDICTION_WIN = "prediction_win"
    REFERRAL = "referral"
    STAKING = "staking"
    FIRST_SWAP = "first_swap"
    FIRST_LP = "first_lp"
    FIRST_BORROW = "first_borrow"


class Achievement:
    def __init__(self, name: str, description: str, icon: str,
                 achievement_type: AchievementType, threshold: float):
        self.id = str(uuid.uuid4())
        self.name = name
        self.description = description
        self.icon = icon
        self.achievement_type = achievement_type
        self.threshold = threshold


class UserProfile:
    def __init__(self, address: str):
        self.address = address
        self.xp = 0
        self.level = 1
        self.achievements: List[str] = []
        self.trade_volume = 0.0
        self.total_swaps = 0
        self.lp_duration_days = 0.0
        self.prediction_wins = 0
        self.referral_count = 0
        self.join_time = time.time()

    def add_xp(self, amount: int):
        self.xp += amount
        self.level = max(self.level, int(self.xp ** 0.5 / 2) + 1)

    def record_swap(self, volume: float):
        self.total_swaps += 1
        self.trade_volume += volume
        self.add_xp(int(volume / 10))

    def record_prediction_win(self):
        self.prediction_wins += 1
        self.add_xp(50)

    def to_dict(self) -> dict:
        return {
            "address": self.address,
            "xp": self.xp,
            "level": self.level,
            "achievements": self.achievements,
            "trade_volume": self.trade_volume,
            "total_swaps": self.total_swaps,
            "prediction_wins": self.prediction_wins,
        }


class ProfileEngine:
    def __init__(self):
        self.profiles: Dict[str, UserProfile] = {}
        self.achievements: Dict[str, Achievement] = {}
        self._init_achievements()

    def _init_achievements(self):
        achievements = [
            ("First Swap", "Complete your first swap", "🔄", AchievementType.FIRST_SWAP, 1),
            ("Swap Master", "Complete 100 swaps", "🔄", AchievementType.TRADE_VOLUME, 100),
            ("LP Pioneer", "Provide liquidity for 7 days", "💧", AchievementType.LP_DURATION, 7),
            ("LP Veteran", "Provide liquidity for 30 days", "💧", AchievementType.LP_DURATION, 30),
            ("Seer", "Win 10 prediction rounds", "🔮", AchievementType.PREDICTION_WIN, 10),
            ("Prophet", "Win 50 prediction rounds", "🔮", AchievementType.PREDICTION_WIN, 50),
            ("Friend Bringer", "Refer 5 users", "👥", AchievementType.REFERRAL, 5),
            ("Stake Lord", "Stake for 90 days", "🔒", AchievementType.STAKING, 90),
        ]
        for name, desc, icon, atype, threshold in achievements:
            ach = Achievement(name, desc, icon, atype, threshold)
            self.achievements[ach.id] = ach

    def get_or_create_profile(self, address: str) -> UserProfile:
        if address not in self.profiles:
            self.profiles[address] = UserProfile(address)
        return self.profiles[address]

    def check_achievements(self, address: str) -> List[str]:
        profile = self.get_or_create_profile(address)
        new_achievements = []
        for aid, ach in self.achievements.items():
            if aid in profile.achievements:
                continue
            earned = False
            if ach.achievement_type == AchievementType.FIRST_SWAP and profile.total_swaps >= 1:
                earned = True
            elif ach.achievement_type == AchievementType.TRADE_VOLUME and profile.total_swaps >= ach.threshold:
                earned = True
            elif ach.achievement_type == AchievementType.PREDICTION_WIN and profile.prediction_wins >= ach.threshold:
                earned = True
            if earned:
                profile.achievements.append(aid)
                profile.add_xp(100)
                new_achievements.append(ach.name)
        return new_achievements
