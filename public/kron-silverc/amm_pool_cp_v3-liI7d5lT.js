const e=`pragma silverscript ^0.1.0;

// KRON native-L1 constant-product AMM pool — V3 (single-token swaps). Successor to the earlier v2 pool covenant (now removed; this is the sole pool covenant).
//
// V3 CHANGE (UX + throughput — see docs/DESIGN-single-token-swaps.md): swaps are made symmetric so EVERY trade
// is one tx / one signature / one resulting token UTXO — no pre-split, no fragmentation.
//   • swapTokenForKas: the trader may fold PART of a token piece in and receive the unsold remainder back as a
//     single presence-owned change output (covid-A outputs = [pool reserve] OR [pool reserve, trader change]).
//   • swapKasForToken: the trader may also bring their EXISTING token UTXO(s) as inputs; the bought amount is
//     merged with them into ONE consolidated trader output (covid-A outputs == [pool reserve, trader token]).
// All paths reuse kcc20 conservation (inSum==outSum), presence ownership, and the k-invariant. The LP paths
// additionally authenticate one canonical inventory lineage and address-owned redemption positions.
//
// MODEL (NEW deployments only):
//   • The graduation-seeded liquidity is a PERMANENTLY-LOCKED floor (rug-proof) — \`lockedShares\`, never removable.
//   • On top of it, anyone (incl. the creator) can add/remove VOLUNTARY liquidity and earn swap fees.
//   • LP shares follow KRON's INVENTORY model (kcc20 conservation) — NOT mint/burn: a fixed LP-share token \`L\`
//     is pre-minted once at graduation, the pool HOLDS the unissued shares as inventory, and add/removeLiquidity
//     MOVE shares between inventory and the LP. \`totalShares\` (state) = issued = lockedShares + voluntary.
//   • Fee model (option ii): each swap, the LP fee splits by share ratio — the FLOOR's slice
//     (lpFee · lockedShares / totalShares) is paid OUT to the creator; the remainder stays in the pool for
//     voluntary LPs. LOCKED post-grad schedule: 0.35% = creator 0.10 (base) / platform 0.05 / LP 0.20.
//
// SECURITY — the pool owns TWO covenant tokens (A reserve + L inventory), both covenant-id-owned and thus
// spendable whenever the pool covenant is a tx input. So EVERY entrypoint must fully constrain BOTH covenant
// groups it authorizes: swaps forbid any L movement (OpCovOutputCount(lpCovid)==0); add/removeLiquidity validate
// the exact L move. Otherwise an attacker could attach the pool's inventory to a tx and divert it.
//
// Overflow: MAX_UNITS=9e8, MAX_TOKEN=1e9, MAX_SHARES=1e7. k=kasReserve·tokenReserve ≤ 9e17; the swap floor-rent
// product lpFeeSompi·lockedShares ≤ 1.8e18 given feesOk()'s lpFeeBps·lockedShares ≤ 2e7 bound; share
// cross-products ≤ 1e16 — all under 2^63 (≈9.22e18). Matches curve_cp MAX_KAS=9e14 (9,000,000 KAS).
contract AmmPoolCpV3(
    int initKas,                // kasReserve in SCALE units (pool UTXO value == kasReserve · SCALE)
    int initToken,              // token reserve (whole tokens)
    int initTotalShares,        // issued LP shares at genesis (= lockedShares at graduation)
    int lockedShares,           // permanently-locked floor shares (constant; totalShares can never drop below it)
    byte[32] initTokenCovid,    // the token covenant-id A this pool trades
    byte[] tokPrefix,           // kcc20 template parts (shared by token A AND the LP-share token L — same contract)
    byte[] tokSuffix,
    byte[32] tokTemplateHash,
    int tokPrefixLen,           // canonical lengths of the same baked template parts; explicit scalars keep
    int tokSuffixLen,           // foreign-input validation compact instead of recompiling byte[].length at each use
    byte[32] initLpCovid,       // LP-share token covid L — ZERO at graduation; bound post-grad by bindLp. STATE,
                                // not baked: covid circular dep (pool bakes lpCovid ↔ L outputs owned by poolCovid).
    pubkey creatorFeeOwner,     // P2PK: creator base fee + the floor's LP-fee share
    pubkey platformFeeOwner,    // P2PK: platform share of the swap fee
    int creatorFeeBps,          // creator base fee, e.g. 10 = 0.10%
    int platformFeeBps,         // platform fee, e.g. 5 = 0.05%
    int lpFeeBps                // LP fee, e.g. 20 = 0.20% (floor→creator out / voluntary→in-pool)
) {
    int kasReserve = initKas;
    int tokenReserve = initToken;
    byte[32] tokenCovid = initTokenCovid;
    int totalShares = initTotalShares;
    byte[32] lpCovid = initLpCovid;   // bound from ZERO → real covid by bindLp (one-time, post-graduation)

    struct TokenState {
        byte[32] ownerIdentifier;
        byte identifierType;
        int amount;
        bool isMinter;
    }

    int constant SELF_OUT = 0;
    int constant LP_INV_OUT = 1;         // bindLp: the pool's L-share inventory genesis output (the ONLY L output)
                                         // OPTION A: the locked floor is NOT tokenized — no burned floor output.
    byte constant IDENTIFIER_COVENANT_ID = 0x02;
    byte constant IDENTIFIER_ADDRESS = 0x03;
    byte[32] constant ZERO_COVID = 0x0000000000000000000000000000000000000000000000000000000000000000;
    int constant SCALE = 1000000;        // 1e6 sompi = 0.01 KAS (matches curve_cp)
    int constant MAX_UNITS = 900000000;  // 9e8 SCALE units = 9e6 KAS (matches curve_cp MAX_KAS/SCALE)
    int constant MAX_TOKEN = 1000000000; // 1e9 tokens
    int constant MAX_SHARES = 10000000;  // 1e7 — the LP-share token's FIXED total supply S_MAX; also the overflow bound
    int constant MAX_FEE_BPS = 2000;     // bound each baked swap-fee bps so value·bps stays int64-safe at MAX_UNITS
    int constant MAX_BIND_OUTS = 6;      // bindLp output bound (honest = [pool, inventory, change] = 3)
    int constant MAX_RETAIN_WEIGHT = 10000000000; // MAX_UNITS·weight <= 9e18 < 2^63
    int constant ADD_POOL_LP_IN = 3;     // canonical P-owned L inventory in addLiquidity
    int constant REMOVE_POOL_LP_IN = 2;  // canonical P-owned L inventory in removeLiquidity
    int constant REMOVE_HOLDER_LP_IN = 3;// exact address-owned L position being redeemed
    int constant SWAP_POOL_TOKEN_IN = 1;   // both swaps: the P-owned covid-A reserve
    int constant ADD_POOL_TOKEN_IN = 2;    // addLiquidity: reserve sits AFTER the LP's dToken deposit at input 1
    int constant REMOVE_POOL_TOKEN_IN = 1; // removeLiquidity: reserve, ahead of the two L inputs at 2/3

    function sharesOk(): bool {
        return totalShares >= 1 && totalShares <= MAX_SHARES
            && lockedShares >= 0 && lockedShares <= totalShares;
    }

    // int64 safety for the swap floor-rent: creatorFloorRent = lpFeeSompi·lockedShares/totalShares computes the
    // product lpFeeSompi·lockedShares BEFORE dividing, where lpFeeSompi ≤ MAX_UNITS·SCALE·lpFeeBps/10000 =
    // 9e10·lpFeeBps. Bounding lpFeeBps·lockedShares ≤ 2e7 keeps that product ≤ 1.8e18 (≈5× under 2^63), and the
    // plain value·bps fee terms safe too. (Defaults lpFeeBps=20, lockedShares ≤ 1e6 sit exactly at the cap.)
    function feesOk(): bool {
        return creatorFeeBps >= 0 && creatorFeeBps <= MAX_FEE_BPS
            && platformFeeBps >= 0 && platformFeeBps <= MAX_FEE_BPS
            && lpFeeBps >= 0 && lpFeeBps <= MAX_FEE_BPS
            && lpFeeBps * lockedShares <= 20000000
            && lpFeeBps * (MAX_SHARES - lockedShares) <= MAX_RETAIN_WEIGHT;
    }

    // Stateless anti-partition policy shared by both directions. A positive voluntary entitlement rounds up,
    // so splitting cannot reduce cumulative retention. subtract-before-divide avoids numerator+denominator
    // overflow; the explicit weight bound keeps tradeKas·weight <= 9e18 in signed int64.
    function retainedKasCeil(int tradeKas): int {
        int voluntaryShares = totalShares - lockedShares;
        int weight = lpFeeBps * voluntaryShares;
        require(weight >= 0 && weight <= MAX_RETAIN_WEIGHT);
        int retainKas = 0;
        if (weight > 0) {
            int numerator = tradeKas * weight;
            int denominator = 10000 * totalShares;
            require(numerator > 0 && denominator > 0);
            retainKas = (numerator - 1) / denominator + 1;
        }
        return retainKas;
    }

    function solePoolContinuation(): byte[32] {
        byte[32] self = OpInputCovenantId(this.activeInputIndex);
        require(OpCovOutputCount(self) == 1);
        require(OpCovOutputIdx(self, 0) == SELF_OUT);
        return self;
    }

    function requirePoolOwnedNonMinter(TokenState token, byte[32] self) {
        require(token.ownerIdentifier == self);
        require(token.identifierType == IDENTIFIER_COVENANT_ID);
        require(!token.isMinter);
    }

    // Pin the covid-A UTXO this transaction SPENDS to the pool's OWN token reserve — the input-side mirror of the
    // committed \`tokenReserve\`, and the same four-way pin curve_cp applies at INVENTORY_IN (curve_cp.sil buy /
    // sell / graduate / batchBuy). Without it every covid-A entrypoint constrained only the reserve OUTPUT: an
    // attacker who fronts an equal-sized covid-A UTXO of the same token satisfies every output check while the
    // pool's real reserve is left UNSPENT and orphaned (the pool continuation now points at a reserve UTXO that
    // was never consumed), wedging the pool for whoever loses the resulting first-come race. Template + covid +
    // owner + amount together prove identity: the template authenticates the SHAPE (it is identical for every
    // token sharing a (maxIns, maxOuts) pair, so it discriminates nothing on its own), the covid the token, the
    // owner that it is P-owned and non-minter, and amount == tokenReserve that it is the WHOLE committed reserve.
    function requireOwnTokenReserveInput(int reserveInIdx, byte[32] self) {
        require(reserveInIdx < tx.inputs.length);
        require(OpInputCovenantId(reserveInIdx) == tokenCovid);
        TokenState reserveIn = readInputStateWithTemplate(reserveInIdx, tokPrefixLen, tokSuffixLen, tokTemplateHash);
        requirePoolOwnedNonMinter(reserveIn, self);
        require(reserveIn.amount == tokenReserve);
    }

    function validateLivePoolContinuation(int newKas, int newToken, int newShares, byte[32] newLpCovid) {
        require(tx.inputs[this.activeInputIndex].value == kasReserve * SCALE);
        require(tx.outputs[SELF_OUT].value == newKas * SCALE);
        validateOutputState(SELF_OUT, { kasReserve: newKas, tokenReserve: newToken, tokenCovid: tokenCovid, totalShares: newShares, lpCovid: newLpCovid });
    }

    // buy on the DEX: trader adds kasIn (SCALE units) + fees, receives tokenOut from the pool.
    // outputs: [0]=pool [1]=pool token(P) [2]=trader token [3]=creatorFee(+floorRent) [4]=platformFee
    entrypoint function swapKasForToken(int kasIn, int tokenOut, TokenState poolTokenOut, TokenState traderTokenOut) {
        require(kasIn > 0 && kasIn <= MAX_UNITS);
        require(kasReserve >= 1 && kasReserve <= MAX_UNITS);
        require(tokenReserve >= 1 && tokenReserve <= MAX_TOKEN);
        require(tokenOut > 0 && tokenOut < tokenReserve);
        require(sharesOk());
        require(feesOk());                       // int64-safety: bound lpFeeBps·lockedShares + the fee bps
        byte[32] self = solePoolContinuation();
        int newKas = kasReserve + kasIn;
        require(newKas <= MAX_UNITS);
        int newToken = tokenReserve - tokenOut;
        // voluntary LP yield: k must GROW by ≥ the voluntary share of THIS TRADE's LP fee (the floor's share is paid
        // out as creatorFloorRent below). retainKas = (LP fee on kasIn)·volShares/totalShares, kept in-pool — it
        // scales with the TRADE, not the whole pool. Computed in ONE precise step (mirrors creatorFloorRent), NOT via
        // a pre-floored integer bps: \`lpFeeBps·volShares/totalShares\` floors to 0 for any pool under (1/lpFeeBps)
        // voluntary (≈5% at 20bps), silently retaining ZERO for real sub-5% voluntary LPs. At graduation
        // (volShares==0) → retainKas==0 → plain k-never-drops floor. Overflow: lpFeeUnits ≤ MAX_UNITS·MAX_FEE_BPS/1e4 =
        // 1.8e8; lpFeeUnits·volShares ≤ 1.8e8·1e7 = 1.8e15; (newKas−retainKas)·newToken ≤ 9e8·1e9 = 9e17 (< 2^63 ≈ 9.22e18).
        int oldK = kasReserve * tokenReserve;
        int retainKas = retainedKasCeil(kasIn);
        require(retainKas <= kasIn);
        require((newKas - retainKas) * newToken >= oldK);

        validateLivePoolContinuation(newKas, newToken, totalShares, lpCovid);

        requireOwnTokenReserveInput(SWAP_POOL_TOKEN_IN, self);
        requirePoolOwnedNonMinter(poolTokenOut, self);
        require(poolTokenOut.amount == newToken);
        // V3 MERGE: the trader may also input their EXISTING token UTXO(s) (presence-owned, authorized by the kcc20
        // transfer covenant via the co-present P2PK). kcc20 conservation then makes traderTokenOut == tokenOut +
        // Σ(existing) automatically, so we only require it COVERS the bought amount; the excess is the trader's own
        // merged tokens. The pool reserve still drops by EXACTLY tokenOut (newToken pinned above + the k-invariant),
        // so the merge can never extract reserve. EXACTLY 2 covid-A outputs ⇒ trader left with ONE consolidated UTXO.
        require(OpCovOutputCount(tokenCovid) == 2);
        require(traderTokenOut.amount >= tokenOut);
        require(traderTokenOut.identifierType == IDENTIFIER_ADDRESS);   // presence-owned → trader can sell back
        require(!traderTokenOut.isMinter);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 0), poolTokenOut, tokPrefix, tokSuffix, tokTemplateHash);
        // value continuation (findings row 14): the reserve's native KAS may never be shaved. RELATIVE, so no dust
        // constant is baked into an immutable redeem (the KRN-C4 failure mode). Builders emit max(dust, inputValue).
        require(tx.outputs[OpCovOutputIdx(tokenCovid, 0)].value >= tx.inputs[SWAP_POOL_TOKEN_IN].value);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 1), traderTokenOut, tokPrefix, tokSuffix, tokTemplateHash);
        require(OpCovOutputCount(lpCovid) == 0);   // anti-theft: a swap must never move the LP-share inventory

        int kasInSompi = kasIn * SCALE;
        int creatorFee = kasInSompi * creatorFeeBps / 10000;
        int platformFee = kasInSompi * platformFeeBps / 10000;
        int lpFeeSompi = kasInSompi * lpFeeBps / 10000;
        int creatorFloorRent = lpFeeSompi * lockedShares / totalShares;
        require(tx.outputs[3].scriptPubKey == new ScriptPubKeyP2PK(creatorFeeOwner));
        require(tx.outputs[3].value >= creatorFee + creatorFloorRent);
        require(tx.outputs[4].scriptPubKey == new ScriptPubKeyP2PK(platformFeeOwner));
        require(tx.outputs[4].value >= platformFee);
    }

    // sell on the DEX (V3 — FRACTIONAL): trader folds PART of a token piece into the pool, gets kasOut (SCALE) −
    // fees, and receives the UNSOLD remainder back as one presence-owned change output. No pre-split tx needed.
    // covid-A outputs: [0]=grown pool reserve (pool-owned), OPTIONALLY [1]=trader change (presence-owned).
    // tx outputs: [0]=pool [1]=pool token(P) [2]=creatorFee(+floorRent) [3]=platformFee [4]=OPTIONAL trader change
    entrypoint function swapTokenForKas(int kasOut, TokenState poolTokenOut, TokenState traderChangeOut) {
        require(kasOut > 0 && kasOut <= MAX_UNITS);
        require(kasReserve >= 1 && kasReserve <= MAX_UNITS);
        require(tokenReserve >= 1 && tokenReserve <= MAX_TOKEN);
        require(sharesOk());
        require(feesOk());                       // int64-safety: bound lpFeeBps·lockedShares + the fee bps

        byte[32] self = solePoolContinuation();
        requireOwnTokenReserveInput(SWAP_POOL_TOKEN_IN, self);
        requirePoolOwnedNonMinter(poolTokenOut, self);
        int newToken = poolTokenOut.amount;       // kcc20 conservation: tokenReserve + traderIn == newToken + change
        require(newToken > tokenReserve && newToken <= MAX_TOKEN);
        int nTokOut = OpCovOutputCount(tokenCovid); // [0]=grown reserve, OPTIONAL [1]=trader change
        require(nTokOut >= 1 && nTokOut <= 2);
        require(OpCovOutputCount(lpCovid) == 0);      // anti-theft: a swap must never move the LP-share inventory
        int newKas = kasReserve - kasOut;
        require(newKas >= 1);
        // voluntary LP yield: k must GROW by ≥ the voluntary share of THIS TRADE's LP fee, trade-proportional (see
        // swapKasForToken — precise one-step form, not a pre-floored bps that zeroes sub-5% voluntary LPs).
        // retainKas scales with kasOut, not the whole pool. graduation (volShares==0) → plain floor.
        int oldK = kasReserve * tokenReserve;
        int retainKas = retainedKasCeil(kasOut);
        require(retainKas <= newKas);
        require((newKas - retainKas) * newToken >= oldK);

        validateLivePoolContinuation(newKas, newToken, totalShares, lpCovid);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 0), poolTokenOut, tokPrefix, tokSuffix, tokTemplateHash);
        require(tx.outputs[OpCovOutputIdx(tokenCovid, 0)].value >= tx.inputs[SWAP_POOL_TOKEN_IN].value);   // value continuation — see swapKasForToken
        // V3 CHANGE: the OPTIONAL second covid-A output is the trader's unsold remainder (presence-owned). kcc20
        // conservation forces change == traderIn − (newToken − tokenReserve), so it can only return the trader's OWN
        // tokens; the k-invariant above pins newToken to kasOut, so the trader takes KAS only for what's folded in.
        if (nTokOut == 2) {
            require(traderChangeOut.amount >= 1 && traderChangeOut.amount <= MAX_TOKEN);
            require(traderChangeOut.identifierType == IDENTIFIER_ADDRESS);
            require(!traderChangeOut.isMinter);
            validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 1), traderChangeOut, tokPrefix, tokSuffix, tokTemplateHash);
        }

        int kasOutSompi = kasOut * SCALE;
        int creatorFee = kasOutSompi * creatorFeeBps / 10000;
        int platformFee = kasOutSompi * platformFeeBps / 10000;
        int lpFeeSompi = kasOutSompi * lpFeeBps / 10000;
        int creatorFloorRent = lpFeeSompi * lockedShares / totalShares;
        require(tx.outputs[2].scriptPubKey == new ScriptPubKeyP2PK(creatorFeeOwner));
        require(tx.outputs[2].value >= creatorFee + creatorFloorRent);
        require(tx.outputs[3].scriptPubKey == new ScriptPubKeyP2PK(platformFeeOwner));
        require(tx.outputs[3].value >= platformFee);
    }

    // addLiquidity: deposit dKas (SCALE units) + dToken at the CURRENT ratio (no price impact); receive dShares of
    // the LP token L, MOVED out of the pool's inventory (conservation, not minted). issued (totalShares) += dShares.
    // outputs: [0]=pool(grown) [token-A group]=pool reserve(+dToken, sole covid-A out)
    //          [lp group: 0]=reduced pool L-inventory (pool-owned) [lp group: 1]=LP's dShares (presence-owned)
    entrypoint function addLiquidity(int dKas, int dToken, int dShares, TokenState poolTokenOut, TokenState poolLpOut, TokenState lpSharesOut) {
        // The LP-share token MUST already be bound. While lpCovid is ZERO the covid predicates below degrade to
        // "is a plain (non-covenant) input" — OpInputCovenantId returns ZERO for an ordinary P2PK input — so an
        // unbound pool would accept arbitrary inputs as LP shares. That can push totalShares above the floor and
        // permanently brick bindLp (which requires totalShares == lockedShares), and with it every swap.
        require(lpCovid != ZERO_COVID);
        require(dKas > 0 && dKas <= MAX_UNITS);
        require(dToken > 0 && dToken <= MAX_TOKEN);
        require(dShares > 0 && dShares <= MAX_SHARES);
        require(kasReserve >= 1 && kasReserve <= MAX_UNITS);
        require(tokenReserve >= 1 && tokenReserve <= MAX_TOKEN);
        require(sharesOk());
        byte[32] self = solePoolContinuation();

        // FLOORED proportional deposit (mirrors the floored removeLiquidity): the depositor adds dKas and receives
        // dShares = floor(totalShares·dKas/kasReserve). The ≤ bound caps shares at no MORE than the KAS-contribution
        // fraction, so existing LPs are NEVER diluted on the KAS side; the (·+1)> bound pins dShares to the floor so
        // the depositor gets fair value (the sub-share KAS remainder stays in the pool, favoring the other LPs).
        // This removes the old exact-equality lcm "step" that forced a near-whole-pool minimum deposit (the bug this
        // fixes: a pool whose reserves are coprime to totalShares had a deposit step == kasReserve, so a small
        // deposit was impossible — ANY dKas now deposits). Overflow: dShares·kasReserve ≤ 1e7·9e8 = 9e15;
        // totalShares·dKas ≤ 1e7·9e8 = 9e15; (dShares+1)·kasReserve ≤ 9e15 — all under 2^63 (≈9.22e18).
        require(dShares * kasReserve <= totalShares * dKas);
        require((dShares + 1) * kasReserve > totalShares * dKas);
        // dToken = ceil(tokenReserve·dShares/totalShares): the depositor must supply AT LEAST the token proportional
        // to the shares minted (no dilution on the token side either), pinned to the ceiling so they supply no more
        // than necessary. Overflow: dToken·totalShares ≤ 1e9·1e7 = 1e16; tokenReserve·dShares ≤ 1e9·1e7 = 1e16.
        require(dToken * totalShares >= tokenReserve * dShares);
        require((dToken - 1) * totalShares < tokenReserve * dShares);
        int newKas = kasReserve + dKas;
        int newToken = tokenReserve + dToken;
        int newShares = totalShares + dShares;
        require(newKas <= MAX_UNITS && newToken <= MAX_TOKEN && newShares < MAX_SHARES);

        validateLivePoolContinuation(newKas, newToken, newShares, lpCovid);

        // token A: the LP's deposited dToken is folded into the pool's reserve (sole covid-A output, pool-owned).
        // kcc20 conservation guarantees pool_in(tokenReserve) + LP_in(dToken) == newToken.
        require(OpCovOutputCount(tokenCovid) == 1);
        requireOwnTokenReserveInput(ADD_POOL_TOKEN_IN, self);
        requirePoolOwnedNonMinter(poolTokenOut, self);
        require(poolTokenOut.amount == newToken);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 0), poolTokenOut, tokPrefix, tokSuffix, tokTemplateHash);
        require(tx.outputs[OpCovOutputIdx(tokenCovid, 0)].value >= tx.inputs[ADD_POOL_TOKEN_IN].value);   // value continuation — see swapKasForToken

        // Token L accounting is pinned to the canonical inventory INPUT at its protocol-fixed index. Merely
        // pinning the output amount is insufficient: an attacker could otherwise leave the real inventory
        // unspent, substitute unrelated holder balances, and later use the stale inventory as a withdrawal
        // credential. Fixed-index template + covid + state validation proves this transition consumes the one
        // inventory matching the pre-state commitment; KCC-20 conservation then forbids any additional L value.
        int oldInventory = MAX_SHARES - totalShares;
        int newInventory = MAX_SHARES - newShares;
        require(oldInventory >= 1 && newInventory >= 1);
        require(ADD_POOL_LP_IN < tx.inputs.length);
        require(OpInputCovenantId(ADD_POOL_LP_IN) == lpCovid);
        TokenState inventoryIn = readInputStateWithTemplate(ADD_POOL_LP_IN, tokPrefixLen, tokSuffixLen, tokTemplateHash);
        requirePoolOwnedNonMinter(inventoryIn, self);
        require(inventoryIn.amount == oldInventory);

        // exactly two outputs — the reduced pool inventory and the newly issued holder shares.
        require(OpCovOutputCount(lpCovid) == 2);
        requirePoolOwnedNonMinter(poolLpOut, self);
        require(poolLpOut.amount == newInventory);
        require(lpSharesOut.amount == dShares);
        require(lpSharesOut.identifierType == IDENTIFIER_ADDRESS);   // presence-owned → the LP holds & can remove later
        require(!lpSharesOut.isMinter);
        validateOutputStateWithTemplate(OpCovOutputIdx(lpCovid, 0), poolLpOut, tokPrefix, tokSuffix, tokTemplateHash);
        require(tx.outputs[OpCovOutputIdx(lpCovid, 0)].value >= tx.inputs[ADD_POOL_LP_IN].value);   // value continuation — see swapKasForToken
        validateOutputStateWithTemplate(OpCovOutputIdx(lpCovid, 1), lpSharesOut, tokPrefix, tokSuffix, tokTemplateHash);
    }

    // removeLiquidity: return dShares of L to the pool inventory; withdraw a strictly proportional dKas + dToken.
    // THE FLOOR GUARD: totalShares − dShares ≥ lockedShares — the graduation-seeded floor can NEVER be withdrawn.
    // The withdrawn dKas is the tx change (pool value drops by dKas·SCALE); only the LP can run this (their L
    // shares are presence-owned, so kcc20 needs their co-present P2PK input to authorize the spend).
    // outputs: [token-A: 0]=pool reserve(−dToken, pool-owned) [token-A: 1]=LP's withdrawn token (presence)
    //          [lp: 0]=the dShares returned to the pool (pool-owned)
    entrypoint function removeLiquidity(int dShares, int dKas, int dToken, TokenState poolTokenOut, TokenState lpTokenOut, TokenState poolLpOut) {
        // The LP-share token MUST already be bound. While lpCovid is ZERO the covid predicates below degrade to
        // "is a plain (non-covenant) input" — OpInputCovenantId returns ZERO for an ordinary P2PK input — so an
        // unbound pool would accept arbitrary inputs as LP shares. That can push totalShares above the floor and
        // permanently brick bindLp (which requires totalShares == lockedShares), and with it every swap.
        require(lpCovid != ZERO_COVID);
        require(dShares > 0 && dShares <= MAX_SHARES);
        require(dKas >= 0 && dKas <= MAX_UNITS);
        require(dToken >= 0 && dToken <= MAX_TOKEN);
        require(dKas > 0 || dToken > 0);
        require(kasReserve >= 1 && kasReserve <= MAX_UNITS);
        require(tokenReserve >= 1 && tokenReserve <= MAX_TOKEN);
        require(sharesOk());
        byte[32] self = solePoolContinuation();

        require(totalShares - dShares >= lockedShares);   // FLOOR GUARD — locked liquidity is never withdrawable

        // FLOORED proportional withdrawal: dKas = floor(kasReserve·dShares/totalShares), dToken likewise. The ≤
        // bound caps the LP at no MORE than their proportional share (the pool can never be over-drained — the
        // security guarantee); the (·+1)> bound pins each to EXACTLY the floor so the LP gets fair value and the
        // sub-unit remainder stays in the pool (favoring the remaining LPs). Unlike the old exact-equality form,
        // ANY dShares now withdraws — there is no integer "step" that can strand a voluntary LP (the bug this
        // fixes: a pool whose reserves are coprime to totalShares had a step == totalShares, unreachable by a
        // voluntary LP under the floor guard). Overflow: (·+1)·totalShares ≤ 1e9·1e7 = 1e16; reserve·dShares ≤
        // 1e9·1e7 = 1e16 — both well under 2^63 (≈9.22e18).
        require(dKas * totalShares <= kasReserve * dShares);
        require((dKas + 1) * totalShares > kasReserve * dShares);
        require(dToken * totalShares <= tokenReserve * dShares);
        require((dToken + 1) * totalShares > tokenReserve * dShares);
        int newKas = kasReserve - dKas;
        int newToken = tokenReserve - dToken;
        int newShares = totalShares - dShares;
        require(newKas >= 1 && newToken >= 1 && newShares >= 1);   // pool stays alive

        validateLivePoolContinuation(newKas, newToken, newShares, lpCovid);

        // token A: a zero token-side floor has no recipient output; a positive side has exactly one. This keeps
        // small LP positions live without permitting an unconstrained token movement on the zero side.
        int expectedTokenOuts = 1;
        if (dToken > 0) { expectedTokenOuts = 2; }
        require(OpCovOutputCount(tokenCovid) == expectedTokenOuts);
        requireOwnTokenReserveInput(REMOVE_POOL_TOKEN_IN, self);
        requirePoolOwnedNonMinter(poolTokenOut, self);
        require(poolTokenOut.amount == newToken);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 0), poolTokenOut, tokPrefix, tokSuffix, tokTemplateHash);
        require(tx.outputs[OpCovOutputIdx(tokenCovid, 0)].value >= tx.inputs[REMOVE_POOL_TOKEN_IN].value);   // value continuation — see swapKasForToken
        if (dToken > 0) {
            require(lpTokenOut.amount == dToken);
            require(lpTokenOut.identifierType == IDENTIFIER_ADDRESS);
            require(!lpTokenOut.isMinter);
            validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 1), lpTokenOut, tokPrefix, tokSuffix, tokTemplateHash);
        }

        // Authenticate both L inputs at fixed roles: the complete pre-state inventory and one genuine,
        // address-owned holder position of exactly dShares. This rejects pool-owned replay fragments and
        // same-template decoys before conservation is trusted. The sole output is the complete enlarged
        // inventory, so KCC-20 conservation binds these inputs to the totalShares delta and leaves no fragment.
        int oldInventory = MAX_SHARES - totalShares;
        int newInventory = MAX_SHARES - newShares;
        require(oldInventory >= 1 && newInventory >= 1);
        require(REMOVE_HOLDER_LP_IN < tx.inputs.length);
        require(OpInputCovenantId(REMOVE_POOL_LP_IN) == lpCovid);
        require(OpInputCovenantId(REMOVE_HOLDER_LP_IN) == lpCovid);
        TokenState inventoryIn = readInputStateWithTemplate(REMOVE_POOL_LP_IN, tokPrefixLen, tokSuffixLen, tokTemplateHash);
        TokenState holderIn = readInputStateWithTemplate(REMOVE_HOLDER_LP_IN, tokPrefixLen, tokSuffixLen, tokTemplateHash);
        requirePoolOwnedNonMinter(inventoryIn, self);
        require(inventoryIn.amount == oldInventory);
        require(holderIn.identifierType == IDENTIFIER_ADDRESS);
        require(holderIn.amount == dShares);
        require(!holderIn.isMinter);

        // sole L output is the complete new inventory, not merely the returned holder amount.
        require(OpCovOutputCount(lpCovid) == 1);
        requirePoolOwnedNonMinter(poolLpOut, self);
        require(poolLpOut.amount == newInventory);
        validateOutputStateWithTemplate(OpCovOutputIdx(lpCovid, 0), poolLpOut, tokPrefix, tokSuffix, tokTemplateHash);
        require(tx.outputs[OpCovOutputIdx(lpCovid, 0)].value >= tx.inputs[REMOVE_POOL_LP_IN].value);   // value continuation — see swapKasForToken
    }

    // bindLp: ONE-TIME, permissionless — genesis-mint the LP-share token L (FIXED supply = MAX_SHARES) and bind
    // lpCovid into the pool. Mirrors curve_cp.init: the L genesis outputs carry NO minter branch, so L can never
    // be minted again (supply fixed forever). The virtual floor is intentionally never minted; the remaining
    // MAX_SHARES − lockedShares seeds the pool inventory (owned by pool covid P). Runs only while unbound —
    // graduation, before any addLiquidity (which needs a bound lpCovid). Deterministic outputs ⇒ no grief.
    // outputs: [0]=pool (lpCovid bound) [1]=pool L-inventory (P-owned) — the SOLE L genesis output
    // OPTION A — the locked floor is NOT a token. bindLp genesis-mints ONLY the pool's issuable L inventory
    // (MAX_SHARES − lockedShares). The permanently-locked floor (\`lockedShares\`) is never minted: it exists solely
    // as the immutable counter + the removeLiquidity floor guard (totalShares − dShares ≥ lockedShares), backed by
    // the pool's own reserves. There is no ZERO-owned "burned" output, so there is nothing an attacker can seize.
    // (Supersedes the old burn-to-ZERO floor: a plain input satisfies OpInputCovenantId==ZERO, so a ZERO-owned
    //  balance is spendable — the burn was not a burn. Removing the object closes that hole at the source.)
    entrypoint function bindLp(TokenState lpInventory) {
        require(lpCovid == ZERO_COVID);            // one-time binding
        require(sharesOk());
        require(feesOk());                         // int64-safety: never bind a pool with unsafe fee/share config
        require(totalShares == lockedShares);      // graduation state: no voluntary shares issued yet
        require(lockedShares >= 1 && lockedShares < MAX_SHARES);
        byte[32] self = solePoolContinuation();
        // anti-theft: bindLp is a covid-P input, which authorizes spending the pool's covid-A token reserve
        // (a separate P-owned UTXO). bindLp must never move it. Honest bind touches no covid-A output ⇒ count 0.
        require(OpCovOutputCount(tokenCovid) == 0);

        // the SOLE L genesis output is the inventory. Validated by DIRECT index (a genesis group's count is 0
        // until first spent, so OpCovOutputIdx can't see it yet — same as curve_cp.init).
        byte[32] boundLp = OpOutputCovenantId(LP_INV_OUT);
        require(boundLp != ZERO_COVID);
        // KRN-C1 (CRITICAL): consensus gives an output a covenant id two ways — as a GENESIS output, where the
        // id derives from the authorizing outpoint, or as a CONTINUATION, where it is inherited from an input
        // already carrying it. Everything below proves the output is a well-formed kcc20 balance of the right
        // amount; NOTHING proved it was genesis. validateOutputStateWithTemplate can't: the kcc20 template is
        // identical for every token sharing a (maxIns, maxOuts) pair, so it discriminates nothing.
        //
        // Without this line an attacker pre-mints their own kcc20 token, splits off exactly
        // MAX_SHARES − lockedShares, and hands the pool that piece as a CONTINUATION. Every other check passes
        // (the reserve is untouched, the full-output scan finds no second covid-L output because they spend
        // their whole input here, the amount matches exactly) — and the pool now treats the attacker's token as
        // its LP shares while they still hold the rest of the supply. Those retained units are valid holder
        // positions: removeLiquidity asks only that the holder input carry lpCovid, be address-owned and
        // non-minter, so they withdraw real KAS and real tokens against counterfeit shares. The locked floor
        // survives; every voluntary LP position does not.
        //
        // A continuation is impossible without an input carrying the id, so an input count of zero separates
        // the two cases exactly. This is NOT a race to win: bindLp must be its own transaction (the pool covid
        // does not exist until graduation confirms) and graduation is permissionless, so an attacker can
        // graduate a token themselves and bind in the very next transaction, uncontested.
        require(OpCovInputCount(boundLp) == 0);
        // Belt-and-braces: L must be its own token, never the pool's own reserve asset. The covid-A output
        // count check above already forces this, but that guard is about not moving the reserve — this one is
        // about identity, and it should not depend on the other one holding.
        require(boundLp != tokenCovid);

        // C-1 (CRITICAL — mirrored from curve_cp.init): genesis supply integrity for the LP-share token L.
        // Consensus lets a binder append EXTRA covid-L genesis outputs (a hidden minter branch or a pre-mine),
        // INVISIBLE to OpCovOutputCount. So scan EVERY output and forbid covid L anywhere except the inventory
        // (idx 1). This also closes the old ZERO-floor route: a floor ticket would be a 2nd covid-L output at
        // idx≠1 and is rejected here. The pool continuation (idx 0) reports P ≠ L; a P2PK change reports ZERO ≠ L.
        int nOut = tx.outputs.length;
        require(nOut <= MAX_BIND_OUTS);
        for (i, 0, nOut, MAX_BIND_OUTS) {
            if (i != LP_INV_OUT) {
                require(OpOutputCovenantId(i) != boundLp);
            }
        }

        // inventory: EXACTLY MAX_SHARES − lockedShares, owned by the pool covid P (issuable via addLiquidity),
        // non-minter. The floor's lockedShares are intentionally absent from circulation (never minted).
        requirePoolOwnedNonMinter(lpInventory, self);
        require(lpInventory.amount == MAX_SHARES - lockedShares);
        validateOutputStateWithTemplate(LP_INV_OUT, lpInventory, tokPrefix, tokSuffix, tokTemplateHash);

        // bind lpCovid into the pool continuation; value + reserves + totalShares all carry over unchanged.
        require(tx.outputs[SELF_OUT].value == tx.inputs[this.activeInputIndex].value);
        validateOutputState(SELF_OUT, { kasReserve: kasReserve, tokenReserve: tokenReserve, tokenCovid: tokenCovid, totalShares: totalShares, lpCovid: boundLp });
    }
}
`;export{e as default};
