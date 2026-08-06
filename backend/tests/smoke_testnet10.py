"""Live end-to-end smoke test of the HTLC covenant swap on testnet-10.

Flow: create order -> fund HTLC from DEX treasury -> watch funding -> claim
(reveals secret on-chain, credits USDT) -> verify on-chain.

Run:  backend/.venv/bin/python backend/tests/smoke_testnet10.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.covenants.engine import CovenantSwapEngine
from backend.covenants.store import CovenantStore


async def main():
    store = CovenantStore("/tmp/covenant_smoke.db")
    await store.init()
    engine = CovenantSwapEngine(store, network="testnet-10")
    try:
        print("== current DAA:", await engine.rpc.current_daa())

        # 1. create order
        view = await engine.create_order("kaspatest:qrlc9t0mncjgm6t5hcdrz7fjzz678tkh3dcekagf2s7wkxssx0gu5rkjj564z", 0.5)
        print("== order created")
        print("   id        :", view["id"])
        print("   htlc addr :", view["htlcAddress"])
        print("   timeout   :", view["timeoutDaa"], "(~", (view["timeoutDaa"] - await engine.rpc.current_daa()) // 60, "min )")

        # 2. fund from DEX treasury
        fund = await engine.fund_htlc_from_dex(view["id"], 0.5)
        print("== funding submitted:", fund["fundTxId"])

        # 3. poll until funding shows up, then claim
        order = await store.get_order(view["id"])
        for i in range(30):
            await asyncio.sleep(4)
            state = await engine.refresh_funding(order)
            print(f"   poll {i + 1}: state={state} onchain_bal={await engine.rpc.address_balance(order['htlc_address']) / 100_000_000} KAS")
            if state == "funded":
                break
        else:
            print("!! funding not observed in 2 min"); return

        # 4. claim
        result = await engine.claim_order(view["id"])
        print("== CLAIMED")
        for k, v in result.items():
            print(f"   {k}: {v}")

        # 5. verify credits
        credits = await store.get_credits(order["maker_address"])
        print("== credits:", credits)

        # 6. verify on-chain: tx accepted by explorer API
        import httpx
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"https://api-tn10.kaspa.org/transactions/{result['claimTxId']}")
            if r.status_code == 200:
                d = r.json()
                print("== on-chain accepted. inputs:", len(d.get("inputs", [])), "outputs:", d.get("outputs"))
                sig_hex = (d.get("inputs") or [{}])[0].get("signatureScript", "")
                print("   claim sig script contains redeem+P2SH:", "aa20" in sig_hex.lower() or len(sig_hex) > 400)
            else:
                print("!! tx not found by explorer yet:", r.status_code)
    finally:
        await store.close()


if __name__ == "__main__":
    asyncio.run(main())
