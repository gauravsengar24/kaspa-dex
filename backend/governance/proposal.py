import time
import uuid
from typing import List, Optional, Dict


class GovernanceProposal:
    def __init__(self, title: str, description: str, proposer: str,
                 targets: List[str], values: List[float], calldatas: List[str],
                 voting_period_days: float = 3, timelock_days: float = 2):
        self.id = str(uuid.uuid4())
        self.title = title
        self.description = description
        self.proposer = proposer
        self.targets = targets
        self.values = values
        self.calldatas = calldatas
        self.start_time = time.time() + 3600  # 1 hr delay
        self.end_time = self.start_time + voting_period_days * 86400
        self.timelock_end = self.end_time + timelock_days * 86400
        self.for_votes = 0.0
        self.against_votes = 0.0
        self.abstain_votes = 0.0
        self.executed = False
        self.cancelled = False
        self.quorum = 100000  # minimum votes needed
        self.votes: Dict[str, str] = {}  # user -> support/against/abstain

    def cast_vote(self, voter: str, support: str, voting_power: float):
        if self.cancelled:
            raise ValueError("Proposal cancelled")
        if time.time() < self.start_time:
            raise ValueError("Voting not started")
        if time.time() >= self.end_time:
            raise ValueError("Voting ended")
        self.votes[voter] = support
        if support == "for":
            self.for_votes += voting_power
        elif support == "against":
            self.against_votes += voting_power
        else:
            self.abstain_votes += voting_power

    def has_passed(self) -> bool:
        total = self.for_votes + self.against_votes
        if total < self.quorum:
            return False
        return self.for_votes > self.against_votes

    def execute(self) -> bool:
        if self.executed:
            return False
        if self.cancelled:
            return False
        if time.time() < self.timelock_end:
            return False
        if not self.has_passed():
            return False
        self.executed = True
        return True

    def cancel(self):
        self.cancelled = True

    def get_state(self) -> dict:
        now = time.time()
        if self.cancelled:
            status = "cancelled"
        elif self.executed:
            status = "executed"
        elif now < self.start_time:
            status = "pending"
        elif now < self.end_time:
            status = "active"
        elif now < self.timelock_end:
            status = "succeeded" if self.has_passed() else "defeated"
        else:
            status = "executed" if self.has_passed() else "defeated"
        return {
            "id": self.id,
            "title": self.title,
            "status": status,
            "for_votes": self.for_votes,
            "against_votes": self.against_votes,
            "quorum": self.quorum,
            "start_time": self.start_time,
            "end_time": self.end_time,
        }


class ProposalSystem:
    def __init__(self):
        self.proposals: Dict[str, GovernanceProposal] = {}

    def create_proposal(self, title: str, description: str, proposer: str,
                        targets: List[str], values: List[float], calldatas: List[str]) -> str:
        proposal = GovernanceProposal(title, description, proposer, targets, values, calldatas)
        self.proposals[proposal.id] = proposal
        return proposal.id

    def list_proposals(self) -> List[dict]:
        return [p.get_state() for p in self.proposals.values()]
