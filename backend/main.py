import json
import os
import time
from pathlib import Path
from contextlib import asynccontextmanager

import httpx

from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.models import OrderCreate, SwapRequest, BroadcastRequest, HealthResponse
from backend.orderbook import orderbook
from backend.kaspa_client import node_client, KASPLEX_API_URL
from backend.prices import get_all_prices, get_token_price

# AMM Engine
from backend.amm import CPMMPool, CLMMPool, StableSwapPool, WeightedPool, LBPPool, CryptoPool

# Lending Engine
from backend.lending import LendingEngine, KinkedRateModel, LLAMMA

# Yield Engine
from backend.yield_vaults import YieldVaultRegistry

# Launchpad
from backend.launchpad import IFO, LBPLAunch, DutchAuction, TokenVesting

# Prediction
from backend.prediction import PredictionMarket

# Governance
from backend.governance import VEKaspa, GaugeController, ProposalSystem

# Router
from backend.router import SmartOrderRouter, UniversalRouter, Command, ExecutionPlan

# AI
from backend.ai import SkillRegistry, SwapSkill, LiquiditySkill, YieldSkill

# Profile
from backend.profile import ProfileEngine

# Perpetual Futures
from backend.perp import PerpEngine, OrderSide

# ========== Global Instances ==========

# AMM Pools
amm_pools = {
    "kas-usdt": CPMMPool(1_000_000, 30_000, 0.0005),
    "kas-nacho": CPMMPool(1_250_000, 250_000_000, 0.003),
    "kas-kaspy": CPMMPool(850_000, 50_000_000, 0.003),
    "kas-ghost": CPMMPool(320_000, 18_000_000, 0.0025),
    "kas-kasper": CPMMPool(500_000, 12_000_000, 0.003),
    "kas-pepek": CPMMPool(280_000, 80_000_000, 0.003),
    "kas-kishu": CPMMPool(150_000, 300_000_000, 0.003),
    "nacho-kaspy": CPMMPool(80_000_000, 15_000_000, 0.003),
}

# Concentrated Liquidity Pools
clmm_pools = {}
stable_pools = {
    "stable-usdc-tusd": StableSwapPool([500_000, 500_000], amplification=100.0, fee=0.0004),
}
weighted_pools = {
    "basket-1": WeightedPool([1_000_000, 500_000, 2_000_000], [0.4, 0.2, 0.4], 0.002),
}

# Lending Engine
lending_engine = LendingEngine()
# Create default markets (matching on-chain LendingPool reserves)
for token in ["WKAS", "USDC", "WBTC", "LINK", "USDT"]:
    ltv = {"USDC": 0.85, "USDT": 0.85, "WKAS": 0.75, "WBTC": 0.65, "LINK": 0.50}.get(token, 0.5)
    lt = ltv + 0.05
    lending_engine.create_market(token, ltv=ltv, lt=lt, bonus=0.08)

# LLAMMA
llamma = LLAMMA(A=5.0, base_price=0.15, fee=0.003)

# Yield Vaults
vault_registry = YieldVaultRegistry()
kas_vault = vault_registry.create_vault("KAS Yield Vault", "KAS", deposit_limit=10_000_000)
stable_vault = vault_registry.create_vault("USDT Yield Vault", "USDT", deposit_limit=5_000_000)

# Launchpad
ifos = {}
lbp_launches = {}
dutch_auctions = {}
token_vesting = TokenVesting()

# Prediction
prediction_market = PredictionMarket("KAS/USD", round_duration_minutes=5, min_bet=1, max_bet=10000)

# Governance
ve_kaspa = VEKaspa()
gauge_controller = GaugeController()
proposal_system = ProposalSystem()

# Router
router = SmartOrderRouter()
for pid, pool in amm_pools.items():
    router.add_pool({
        "id": pid,
        "type": "CPMM",
        "token0": pid.split("-")[0].upper(),
        "token1": pid.split("-")[1].upper(),
        "reserve0": pool.reserve0,
        "reserve1": pool.reserve1,
        "fee": pool.fee,
    })

universal_router = UniversalRouter()

# AI Skills
skill_registry = SkillRegistry()
skill_registry.register(SwapSkill(router))
skill_registry.register(LiquiditySkill(amm_pools))
skill_registry.register(YieldSkill(vault_registry))

# Profile
profile_engine = ProfileEngine()

# Perpetual Futures
perp_engine = PerpEngine()

# ========== L1 DEX Configuration (Mainnet) ==========

# DEX wallet address — users send KAS here to initiate swaps
DEX_ADDRESS = os.environ.get("DEX_ADDRESS", "kaspa:qrlc9t0mncjgm6t5hcdrz7fjzz678tkh3dcekagf2s7wkxssx0gu5rkjj564z")

# Off-chain token balance tracking for L1 swaps
token_balances: dict[str, dict[str, float]] = {}

# KAS price (updated by CoinGecko oracle periodically)
KAS_USDT_RATE = 0.15  # updated by prices.py


# ========== FastAPI App ==========

@asynccontextmanager
async def lifespan(app: FastAPI):
    await orderbook.initialize()
    health = await node_client.check_health()
    print(f"Kaspa mainnet node connected: {health}")
    print(f"Active orders: {orderbook.count()}")
    yield


app = FastAPI(
    title="KaspaSwap L1 DEX Backend",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ========== HEALTH ==========
@app.get("/api/health", response_model=HealthResponse)
async def health():
    node_ok = await node_client.check_health()
    return HealthResponse(
        status="ok",
        network="kaspa-mainnet",
        nodeConnected=node_ok,
        orderCount=orderbook.count(),
    )


# ========== PRICES ==========
@app.get("/api/prices")
async def prices():
    return await get_all_prices()

@app.get("/api/prices/refresh")
async def prices_refresh():
    return await get_all_prices(force=True)

@app.get("/api/price/{ticker}")
async def price_token(ticker: str):
    p = await get_token_price(ticker)
    if not p:
        raise HTTPException(status_code=404, detail=f"No price for {ticker}")
    return {ticker.upper(): p}


# ========== ORDERBOOK ==========
@app.get("/api/orderbook/{pair}")
async def get_orders(pair: str):
    return orderbook.get_orders(pair)

@app.get("/api/orderbook")
async def get_all_orders():
    return orderbook.get_orders()

@app.post("/api/orderbook", status_code=201)
async def create_order(order: OrderCreate):
    result = orderbook.submit(order)
    return result

@app.get("/api/orderbook/detail/{oid}")
async def get_order(oid: str):
    order = orderbook.get_order(oid)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order

@app.delete("/api/orderbook/{oid}")
async def cancel_order(oid: str):
    if not orderbook.cancel(oid):
        raise HTTPException(status_code=404, detail="Order not found")
    return {"status": "cancelled"}

@app.post("/api/orderbook/fill/{oid}")
async def fill_order(oid: str):
    if not orderbook.fill(oid):
        raise HTTPException(status_code=400, detail="Order not found or already completed")
    return {"status": "filled"}


# ========== WALLET ==========
@app.get("/api/balance/{address}")
async def get_balance(address: str):
    balance = await node_client.get_balance(address)
    return {"address": address, "balance": balance, "unit": "KAS"}

@app.post("/api/broadcast")
async def broadcast_tx(req: BroadcastRequest):
    tx_id = await node_client.broadcast_transaction(req.txJson)
    if not tx_id:
        raise HTTPException(status_code=502, detail="Failed to broadcast transaction to Kaspa node")
    return {"txId": tx_id, "status": "submitted"}

@app.get("/api/tx/status/{tx_id}")
async def get_tx_status(tx_id: str):
    status = await node_client.get_transaction_status(tx_id)
    if not status:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return status


# ========== L1 DEX ==========
@app.get("/api/network")
async def get_network():
    """Return DEX network configuration for mainnet."""
    from backend.prices import _cache
    rate = _cache.get("kas_usd", KAS_USDT_RATE)
    return {
        "network": "kaspa-mainnet",
        "dexAddress": DEX_ADDRESS,
        "kasUsdtRate": rate,
        "explorer": "https://explorer.kaspa.org",
    }

@app.get("/api/token-balances/{address}")
async def get_token_balances(address: str):
    """Return off-chain credited token balances for a user address."""
    onchain = {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{KASPLEX_API_URL}/krc20/address/{address}/tokenlist")
            if resp.status_code == 200:
                data = resp.json()
                for token in data.get("result", []):
                    ticker = token.get("tick", "").upper()
                    bal = float(token.get("balance", "0")) / (10 ** int(token.get("dec", 8)))
                    if bal > 0:
                        onchain[ticker] = bal
    except Exception:
        pass
    credited = token_balances.get(address, {})
    merged = {**credited, **onchain}
    return {
        "address": address,
        "balances": merged,
        "source": "kasplex-mainnet",
    }

@app.post("/api/log-swap")
async def log_swap(
    address: str = Body(...),
    token_out: str = Body("USDT"),
    amount_out: float = Body(...),
    tx_id: str = Body(""),
):
    """Log a completed L1 swap and credit the user's token balance."""
    if address not in token_balances:
        token_balances[address] = {}
    current = token_balances[address].get(token_out, 0.0)
    token_balances[address][token_out] = round(current + amount_out, 8)
    print(f"SWAP: {address} credited {amount_out} {token_out} (tx: {tx_id})")
    return {
        "address": address,
        "token_out": token_out,
        "amount_out": amount_out,
        "new_balance": token_balances[address][token_out],
        "tx_id": tx_id,
    }


# ========== SWAP (LEGACY) ==========
@app.post("/api/swap/quote")
async def get_swap_quote(req: SwapRequest):
    prices = await get_all_prices()
    kas_usd = prices["kas"]["usd"]
    from_price = 1.0 if req.fromToken == "KAS" else prices["tokens"].get(req.fromToken, {}).get("kas", 0)
    to_price = 1.0 if req.toToken == "KAS" else prices["tokens"].get(req.toToken, {}).get("kas", 0)
    rate = from_price / to_price if from_price > 0 and to_price > 0 else 1
    to_amount = req.fromAmount * rate
    fee = req.fromAmount * 0.003
    min_received = to_amount * (1 - req.slippage / 100)
    impact = 0.05
    return {
        "fromToken": req.fromToken,
        "toToken": req.toToken,
        "fromAmount": req.fromAmount,
        "toAmount": round(to_amount, 8),
        "price": round(rate, 8),
        "kasPrice": kas_usd,
        "priceImpact": impact,
        "fee": round(fee, 8),
        "minReceived": round(min_received, 8),
        "route": [req.fromToken, req.toToken],
        "expiry": int(time.time()) + 30,
    }


# ========== AMM Engine (NEW) ==========
@app.get("/api/amm/pools")
async def list_amm_pools():
    result = {}
    for pid, pool in amm_pools.items():
        t0, t1 = pid.split("-")
        result[pid] = {
            "type": "CPMM",
            "token0": t0.upper(),
            "token1": t1.upper(),
            "reserve0": pool.reserve0,
            "reserve1": pool.reserve1,
            "fee": pool.fee,
            "price": pool.get_price(),
            "k": pool.k,
        }
    for pid, pool in stable_pools.items():
        result[pid] = {
            "type": "STABLE",
            "tokens": list(range(len(pool.balances))),
            "balances": pool.balances,
            "A": pool.A,
            "fee": pool.fee,
            "virtual_price": pool.virtual_price(),
        }
    for pid, pool in weighted_pools.items():
        result[pid] = {
            "type": "WEIGHTED",
            "balances": pool.balances,
            "weights": pool.weights,
            "fee": pool.fee,
        }
    return result

@app.get("/api/amm/quote")
async def amm_quote(token_in: str = "KAS", token_out: str = "NACHO",
                    amount_in: float = 100, pool_type: str = "CPMM"):
    for pid, pool in amm_pools.items():
        t0, t1 = pid.split("-")
        if t0.upper() == token_in.upper() and t1.upper() == token_out.upper():
            tok0_in = True
        elif t0.upper() == token_out.upper() and t1.upper() == token_in.upper():
            tok0_in = False
        else:
            continue
        out = pool.get_output_estimate(amount_in, tok0_in)
        impact = pool.price_impact(amount_in, tok0_in)
        return {
            "pool_id": pid,
            "token_in": token_in,
            "token_out": token_out,
            "amount_in": amount_in,
            "amount_out": out,
            "price_impact": round(impact, 4),
            "fee": pool.fee * amount_in,
        }
    raise HTTPException(status_code=404, detail="Pool not found")

@app.post("/api/amm/swap")
async def amm_swap(pool_id: str, token_in: str, amount_in: float):
    if pool_id in amm_pools:
        pool = amm_pools[pool_id]
        t0, t1 = pool_id.split("-")
        tok0_in = t0.upper() == token_in.upper()
        out = pool.swap_out_given_in(amount_in, tok0_in)
        return {"pool_id": pool_id, "amount_in": amount_in, "amount_out": out}
    raise HTTPException(status_code=404, detail="Pool not found")


# ========== LENDING ==========
@app.get("/api/lending/markets")
async def lending_markets():
    markets = []
    for mid, market in lending_engine.markets.items():
        rates = lending_engine.get_rates(mid)
        markets.append({
            "id": mid,
            "token": market.token,
            "total_supply": market.total_supply,
            "total_borrow": market.total_borrow,
            "total_reserves": market.total_reserves,
            "ltv": market.ltv,
            "liquidation_threshold": market.liquidation_threshold,
            "utilization": rates["utilization"],
            "supply_apr": rates["supply_apr"],
            "borrow_apr": rates["borrow_apr"],
            "is_collateral_enabled": market.is_collateral_enabled,
            "is_borrow_enabled": market.is_borrow_enabled,
        })
    return {"markets": markets}

@app.post("/api/lending/supply")
async def lending_supply(user: str, market_id: str, amount: float):
    supplied, value = lending_engine.supply(user, market_id, amount)
    return {"user": user, "market_id": market_id, "supplied": supplied, "value_usd": value}

@app.post("/api/lending/borrow")
async def lending_borrow(user: str, market_id: str, amount: float, collateral_market: str):
    borrowed, message = lending_engine.borrow(user, market_id, amount, collateral_market)
    return {"user": user, "market_id": market_id, "borrowed": borrowed, "message": message}

@app.post("/api/lending/repay")
async def lending_repay(user: str, market_id: str, amount: float):
    repaid = lending_engine.repay(user, market_id, amount)
    return {"user": user, "market_id": market_id, "repaid": repaid}

@app.get("/api/lending/health/{user}/{market_id}")
async def lending_health(user: str, market_id: str):
    health = lending_engine.get_health(user, market_id)
    return {"user": user, "market_id": market_id, "health_factor": health}

@app.get("/api/lending/rates/{market_id}")
async def lending_rates(market_id: str):
    if market_id not in lending_engine.markets:
        raise HTTPException(404, "Market not found")
    return lending_engine.get_rates(market_id)

@app.post("/api/lending/liquidate")
async def lending_liquidate(user: str, market_id: str, liquidator: str, amount: float):
    repaid, seized = lending_engine.liquidate(user, market_id, liquidator, amount)
    return {"user": user, "market_id": market_id, "repaid": repaid, "seized": seized}


# ========== LLAMMA ==========
@app.get("/api/llamma/state")
async def llamma_state():
    active = llamma.active_band()
    return {
        "base_price": llamma.base_price,
        "oracle_price": llamma.oracle_price(),
        "active_band": active,
        "A": llamma.A,
        "total_collateral": sum(b.collateral_amount for b in llamma.bands),
        "total_stablecoin": sum(b.stablecoin_amount for b in llamma.bands),
    }

@app.post("/api/llamma/swap")
async def llamma_swap(amount: float, collateral_in: bool = True):
    out, fee = llamma.swap(amount, collateral_in)
    return {"amount_in": amount, "amount_out": out, "fee": fee}

@app.get("/api/llamma/health/{collateral}/{debt}")
async def llamma_health(collateral: float, debt: float):
    h = llamma.get_health(collateral, debt)
    liq_price = llamma.calculate_liquidation_price(debt, collateral)
    return {"health_factor": h, "liquidation_price": liq_price}


# ========== YIELD VAULTS ==========
@app.get("/api/yield/vaults")
async def yield_vaults():
    return {"vaults": vault_registry.list_vaults()}

@app.post("/api/yield/deposit")
async def yield_deposit(vault_id: str, amount: float, depositor: str):
    if vault_id not in vault_registry.vaults:
        raise HTTPException(404, "Vault not found")
    vault = vault_registry.vaults[vault_id]
    shares = vault.deposit(amount, depositor)
    return {"vault_id": vault_id, "amount": amount, "shares": shares, "price_per_share": vault.price_per_share()}

@app.post("/api/yield/withdraw")
async def yield_withdraw(vault_id: str, shares: float, owner: str):
    if vault_id not in vault_registry.vaults:
        raise HTTPException(404, "Vault not found")
    vault = vault_registry.vaults[vault_id]
    assets = vault.withdraw(shares, owner)
    return {"vault_id": vault_id, "shares": shares, "assets": assets}


# ========== LAUNCHPAD ==========
@app.get("/api/launchpad/ifos")
async def list_ifos():
    return {"ifos": [ifo.get_state() for ifo in ifos.values()]}

@app.post("/api/launchpad/ifo/create")
async def create_ifo(token: str, token_amount: float, base_token: str = "KAS"):
    ifo = IFO(token, token_amount, base_token)
    ifos[ifo.id] = ifo
    return ifo.get_state()

@app.post("/api/launchpad/ifo/commit")
async def ifo_commit(ifo_id: str, user: str, amount: float, round_name: str = "public"):
    if ifo_id not in ifos:
        raise HTTPException(404, "IFO not found")
    committed = ifos[ifo_id].commit(user, amount, round_name)
    return {"ifo_id": ifo_id, "user": user, "committed": committed}

@app.get("/api/launchpad/lbp")
async def list_lbp():
    return {"lbps": [lbp.get_state() for lbp in lbp_launches.values()]}

@app.post("/api/launchpad/lbp/create")
async def create_lbp(project_token: str, project_amount: float, base_amount: float = 100_000):
    lbp = LBPLAunch(project_token, base_token="KAS", project_amount=project_amount, base_amount=base_amount)
    lbp_launches[lbp.id] = lbp
    return lbp.get_state()

@app.get("/api/launchpad/dutch")
async def list_dutch():
    return {"auctions": [a.get_state() for a in dutch_auctions.values()]}

@app.post("/api/launchpad/dutch/create")
async def create_dutch(token: str, token_amount: float, start_price: float = 1.0, end_price: float = 0.1):
    auction = DutchAuction(token, token_amount, "KAS", start_price, end_price)
    dutch_auctions[auction.id] = auction
    return auction.get_state()

@app.get("/api/launchpad/vesting/{recipient}")
async def get_vesting(recipient: str):
    schedules = [s for s in token_vesting.schedules if s.recipient == recipient]
    return {"schedules": [{
        "id": s.id,
        "token": s.token,
        "total": s.total_amount,
        "vested": s.vested_amount(),
        "claimable": s.claimable(),
    } for s in schedules]}


# ========== PREDICTION ==========
@app.get("/api/prediction/state")
async def prediction_state():
    return prediction_market.get_state()

@app.post("/api/prediction/bet")
async def prediction_bet(user: str, amount: float, direction: str):
    active = prediction_market.get_active_round()
    if not active:
        active = prediction_market.start_new_round(prediction_market._price_feed() if prediction_market._price_feed else 0.15)
    bet = active.place_bet(user, amount, direction)
    return {
        "round_id": active.id,
        "round_number": active.round_number,
        "user": user,
        "amount": bet,
        "direction": direction,
        "lock_price": active.lock_price,
    }

@app.post("/api/prediction/settle")
async def prediction_settle(price: float):
    prediction_market.settle_current_round(price)
    return {"settled": True, "price": price}

@app.get("/api/prediction/payout/{user}/{round_id}")
async def prediction_payout(user: str, round_id: str):
    round_obj = prediction_market.rounds.get(round_id)
    if not round_obj:
        raise HTTPException(404, "Round not found")
    payout = round_obj.calculate_payout(user)
    return {"user": user, "round_id": round_id, "payout": payout}

@app.get("/api/prediction/history")
async def prediction_history():
    rounds = prediction_market.get_rounds_batch(20)
    return {"rounds": [{
        "round_number": r.round_number,
        "lock_price": r.lock_price,
        "result_price": r.result_price,
        "result_direction": r.result_direction,
        "total_bets": r.total_bets_up + r.total_bets_down,
        "settled": r.settled,
    } for r in rounds]}


# ========== GOVERNANCE ==========
@app.post("/api/governance/lock")
async def gov_lock(user: str, amount: float, duration_years: float = 1):
    unlock_time = time.time() + min(duration_years * 365 * 86400, 4 * 365 * 86400)
    ve_kaspa.create_lock(user, amount, unlock_time)
    voting_power = ve_kaspa.get_voting_power(user)
    return {"user": user, "amount": amount, "unlock_time": unlock_time, "voting_power": voting_power}

@app.get("/api/governance/voting-power/{user}")
async def gov_voting_power(user: str):
    vp = ve_kaspa.get_voting_power(user)
    return {"user": user, "voting_power": vp}

@app.get("/api/governance/total-supply")
async def gov_total_supply():
    return {"total_ve_supply": ve_kaspa.total_supply_at()}

@app.post("/api/governance/proposals")
async def create_proposal(title: str, description: str, proposer: str):
    pid = proposal_system.create_proposal(title, description, proposer, [], [], [])
    return {"proposal_id": pid}

@app.get("/api/governance/proposals")
async def list_proposals():
    return {"proposals": proposal_system.list_proposals()}

@app.post("/api/governance/proposals/{proposal_id}/vote")
async def cast_vote(proposal_id: str, voter: str, support: str):
    if proposal_id not in proposal_system.proposals:
        raise HTTPException(404, "Proposal not found")
    vp = ve_kaspa.get_voting_power(voter)
    proposal_system.proposals[proposal_id].cast_vote(voter, support, vp)
    return {"proposal_id": proposal_id, "voter": voter, "support": support, "voting_power": vp}

@app.get("/api/governance/gauges")
async def list_gauges():
    return {"gauges": [
        {"id": g.id, "name": g.name, "pool_type": g.pool_type, "relative_weight": g.relative_weight}
        for g in gauge_controller.gauges.values()
    ]}

@app.post("/api/governance/gauges/vote")
async def gauge_vote(voter: str, gauge_id: str, weight_bps: int):
    gauge_controller.vote(voter, gauge_id, weight_bps)
    return {"voter": voter, "gauge_id": gauge_id, "weight_bps": weight_bps}


# ========== ROUTER ==========
@app.get("/api/router/quote")
async def router_quote(token_in: str, token_out: str, amount_in: float):
    route = router.find_best_route(token_in, token_out, amount_in)
    if not route:
        return {"token_in": token_in, "token_out": token_out, "amount_in": amount_in, "route": None, "error": "No route found"}
    total_out = sum(r.amount_out for r in route)
    return {
        "token_in": token_in,
        "token_out": token_out,
        "amount_in": amount_in,
        "amount_out": total_out,
        "route": [{"pool_id": r.pool_id, "type": r.pool_type, "amount_in": r.amount_in, "amount_out": r.amount_out} for r in route],
    }

@app.post("/api/router/plan")
async def router_plan(command: str, data: dict):
    plan = ExecutionPlan()
    cmd_map = {
        "swap": Command.SWAP_EXACT_IN,
        "supply": Command.LEND_SUPPLY,
        "borrow": Command.LEND_BORROW,
        "deposit": Command.YIELD_DEPOSIT,
        "lock": Command.GOV_LOCK,
    }
    cmd = cmd_map.get(command)
    if cmd is None:
        raise HTTPException(400, f"Unknown command: {command}")
    plan.add(cmd, data)
    return {"plan_id": plan.id, "command_count": len(plan.commands), "deadline": plan.decide}


# ========== AI SKILLS ==========
@app.get("/api/ai/skills")
async def ai_skills():
    return skill_registry.get_openapi_spec()

@app.post("/api/ai/skills/execute")
async def ai_execute(skill: str, params: dict):
    result = skill_registry.execute(skill, params)
    return result


# ========== PROFILE ==========
@app.get("/api/profile/{address}")
async def get_profile(address: str):
    profile = profile_engine.get_or_create_profile(address)
    new_achievements = profile_engine.check_achievements(address)
    return {"profile": profile.to_dict(), "new_achievements": new_achievements}

@app.post("/api/profile/record-swap/{address}")
async def record_swap(address: str, volume: float):
    profile = profile_engine.get_or_create_profile(address)
    profile.record_swap(volume)
    new_achievements = profile_engine.check_achievements(address)
    return {"profile": profile.to_dict(), "new_achievements": new_achievements}


# ========== PERPETUAL FUTURES ==========
@app.post("/api/perp/open")
async def perp_open(user: str, side: str, size: float, leverage: float, current_price: float):
    order_side = OrderSide.LONG if side == "long" else OrderSide.SHORT
    result = perp_engine.open_position(user, order_side, size, leverage, current_price)
    return result

@app.post("/api/perp/close")
async def perp_close(user: str, current_price: float):
    result = perp_engine.close_position(user, current_price)
    return result

@app.get("/api/perp/position")
async def perp_position(user: str, current_price: float = 0.0295):
    pos = perp_engine.get_position(user)
    pnl = perp_engine.get_unrealized_pnl(user, current_price)
    liq = perp_engine.check_liquidation(user, current_price)
    return {"position": pos, "unrealized_pnl": pnl, "liquidation": liq}

@app.get("/api/perp/account")
async def perp_account(user: str, current_price: float = 0.0295):
    return perp_engine.get_account_summary(user, current_price)

@app.get("/api/perp/funding-rate")
async def perp_funding():
    return {"funding_rate": perp_engine.get_funding_rate()}


# ========== FRONTEND ==========
project_dir = Path(__file__).resolve().parent.parent
for candidate in [project_dir / "dist", project_dir / "frontend" / "dist", project_dir / "frontend"]:
    if candidate.exists() and (candidate / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(candidate), html=True), name="frontend")
        break


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
