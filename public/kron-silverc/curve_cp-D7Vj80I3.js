const e=`pragma silverscript ^0.1.0;

// KRON virtual-reserve constant-product bonding curve (KCC-20, native L1, NO rollup) — the inventory model.
//
// Unlike curve_minter.sil (linear mint/burn), this curve NEVER mints or burns during trading. The full token
// supply is minted ONCE at genesis (\`init\`) into the curve's own inventory (owned by covenant-id C) + an
// optional dev allocation (owned by the creator). Mint authority is retired at that moment — no minter branch
// exists, so supply is provably fixed forever ("mint renounced" from block one).
//
// Trading then just MOVES that fixed supply between the curve's inventory and traders, at a constant-product
// price using a VIRTUAL KAS reserve (\`vKas\`) so the curve has a sensible opening price with zero real KAS:
//   invariant:  (vKas + realKas) · tokenReserve  is preserved across every buy/sell
//     realKas      = the curve UTXO's KAS value (what's actually been raised)
//     tokenReserve = the curve's remaining inventory (a C-owned kcc20 balance, read cross-covenant)
// Because buy/sell are plain conserving kcc20 transfers (inventory <-> trader), kcc20.sil is UNCHANGED — the
// asset standard stays pristine; all the launchpad logic lives here.
//
// Graduation (permissionless, once realKas ≥ graduationKas): 95% of the raised KAS + the leftover inventory
// seed the native AMM's permanently locked floor; voluntary liquidity may be layered above it. The remaining
// graduation fee goes to the platform, and the curve locks.
//
// int64 safety: KAS in the constant-product check is measured in SCALE-unit steps (0.01 KAS). With
// MAX_UNITS=9e8 and MAX_TOKEN=1e9, (vKas+nu)·tokenReserve ≤ 1.8e18 and graduation's gradFee·10000 ≤ 9e18,
// both under 2^63 (≈9.22e18). 9,000,000 KAS (MAX_KAS=9e14) is therefore essentially the int64 ceiling, and
// the baked fee bps are bounded (MAX_FEE_BPS) so every value·bps fee term stays safe too.
contract CurveCp(
    pubkey creatorFeeOwner,     // P2PK: receives the creator share of trade fees (+ holds the dev allocation)
    pubkey platformFeeOwner,    // P2PK: receives the platform share of trade fees + the graduation fee
    byte[32] creatorIdentifier, // the creator's x-only pubkey as bytes (== creatorFeeOwner) — the dev-alloc owner
    int vKas,                   // virtual KAS reserve, in SCALE units (sets the opening price / % sold at grad)
    int graduationKas,          // raised-KAS target (curve UTXO value, sompi) that unlocks graduation
    int creatorFeeBps,          // creator trade-fee share, basis points (e.g. 70 = 0.70%)
    int platformFeeBps,         // platform trade-fee share, basis points (e.g. 30 = 0.30%)
    int graduationFeeBps,       // platform's cut of the raised KAS at graduation (e.g. 500 = 5%)
    byte[32] initTokenCovid,    // token covenant-id A (zero placeholder at genesis; bound by \`init\`)
    byte[] tokPrefix,           // kcc20 template parts (validate the token outputs / read inventory state)
    byte[] tokSuffix,
    byte[32] tokTemplateHash,
    int tokPrefixLen,
    int tokSuffixLen,
    byte[] poolPrefix,          // amm_pool_native template parts (validate the pool genesis at graduation)
    byte[] poolSuffix,
    byte[32] poolTemplateHash,
    bool initGraduated,
    int poolLockedShares,       // v2 pool: the permanently-locked floor LP shares; graduate seeds pool.totalShares = this
    int initTokenReserve,       // committed token inventory (0 at genesis; init sets it to inventory.amount)
    byte[32] orderTemplateHash, // refundable buy_order.sil template (batchBuy reads authenticated intents)
    int orderPrefixLen,
    int orderSuffixLen,
    // Dev-fund trade-fee leg (carved out of the platform share: 1.00% → 0.90% platform + 0.10% dev fund; the
    // 1.25% total is unchanged). Declared LAST so every existing ctor arg position stays stable across tooling.
    pubkey devFundOwner,        // P2PK: receives the dev-fund share of trade fees (buy/sell/batchBuy)
    int devFundBps              // dev-fund trade-fee share, basis points (e.g. 10 = 0.10%)
) {
    bool graduated = initGraduated;
    byte[32] tokenCovid = initTokenCovid;
    // AUTHORITATIVE token reserve, committed to the P2SH state (the KAS reserve is the UTXO value; this is the
    // token side). Reading the reserve from an input (the old design) let an attacker present a decoy inventory
    // to spoof the price and drain the curve — so buy/sell/graduate now trust THIS field, not input[1].
    int tokenReserve = initTokenReserve;

    // kcc20 token state layout (must match kcc20.sil field order/types).
    struct TokenState {
        byte[32] ownerIdentifier;
        byte identifierType;
        int amount;
        bool isMinter;
    }
    // amm_pool_cp_v3 state layout (must match amm_pool_cp_v3.sil field order/types).
    struct PoolState {
        int kasReserve;     // in SCALE units (pool UTXO value == kasReserve · SCALE)
        int tokenReserve;
        byte[32] tokenCovid;
        int totalShares;    // v2: issued LP shares at genesis (== poolLockedShares, the locked floor)
        byte[32] lpCovid;   // v2: LP-share token covid — ZERO at graduation; bound later by the pool's bindLp
    }
    struct OrderState {
        byte[32] curveCovid;
        byte[32] buyerIdentifier;
        int kasIn;
        int minTokenOut;
    }

    byte constant IDENTIFIER_COVENANT_ID = 0x02;
    byte constant IDENTIFIER_ADDRESS = 0x03;   // presence-based ownership (buyer tokens — sellable via signPskt)
    byte[32] constant ZERO_COVID = 0x0000000000000000000000000000000000000000000000000000000000000000;

    int constant SCALE = 1000000;              // 1e6 sompi = 0.01 KAS — the KAS step used in the CP invariant
    int constant SELF_OUT = 0;                 // output[0] continues the curve
    int constant INVENTORY_IN = 1;             // buy: input[1] = the curve's C-owned token inventory (covid A)
    int constant SELL_INVENTORY_IN = 1;        // sell: input[1] = inventory (C); input[2..] = the seller's token piece(s)

    // buy outputs:  [0]=curve [1]=inventory(C) [2]=buyer [3]=creatorFee [4]=platformFee [5]=devFundFee
    int constant BUY_INV_OUT = 1;
    int constant BUY_BUYER_OUT = 2;
    int constant BUY_CREATOR_FEE_OUT = 3;
    int constant BUY_PLATFORM_FEE_OUT = 4;
    int constant BUY_DEV_FEE_OUT = 5;
    // sell outputs: [0]=curve [1]=inventory(C) [2]=creatorFee [3]=platformFee [4]=devFundFee  (seller's net refund = change)
    int constant SELL_INV_OUT = 1;
    int constant SELL_CREATOR_FEE_OUT = 2;
    int constant SELL_PLATFORM_FEE_OUT = 3;
    int constant SELL_DEV_FEE_OUT = 4;
    // graduate outputs: [0]=locked curve [1]=pool genesis [2]=pool token (P) [3]=platform graduation fee
    int constant POOL_OUT = 1;
    int constant POOL_TOKEN_OUT = 2;
    int constant GRAD_FEE_OUT = 3;
    // init outputs: [0]=curve(bound A) [1]=inventory(C) [2]=dev allocation(creator)
    int constant INIT_INV_OUT = 1;
    int constant INIT_DEV_OUT = 2;

    // bounds keep (vKas+realKasUnits)·tokenReserve under 2^63 ((vKas+nu)·newToken ≤ 1.8e18 at the maxima below).
    int constant MAX_UNITS = 900000000;        // 9e8 SCALE units = 9e6 KAS (== MAX_KAS/SCALE)
    int constant MAX_TOKEN = 1000000000;       // 1e9 tokens
    int constant MAX_KAS = 900000000000000;    // 9e14 sompi = 9,000,000 KAS (curve value bound; ~int64 ceiling)
    int constant MIN_ORDER_KAS = 50000000;      // 0.5 KAS: keeps each asynchronous order above storage-mass dust
    int constant ORDER_TOKEN_DUST = 50000000;   // buyer token output, pre-funded by that order
    int constant FEE_OUT_MIN = 20000000;        // mass-safe creator/platform output floor, per order
    // NOTE (audit, findings row 14 — NOW ENFORCED, relatively). buy/sell/graduate once left their
    // covenant-owned token OUTPUT value unconstrained, where batchBuy pinned it exactly. Each of those three
    // now carries \`out.value >= in.value\` (see the VALUE CONTINUATION block in each entrypoint).
    //
    // WHY RELATIVE, and why the earlier ABSOLUTE attempt was rejected — this history is the load-bearing part,
    // do not "simplify" it back: batchBuy can pin an exact figure because each order PRE-FUNDS a known escrow,
    // whereas here the dust is chosen by whoever builds the transaction. Baking a constant into the redeem
    // would make any future change to builder dust sizing brick trading on every already-launched token,
    // permanently, because the parameters live in the address — the KRN-C4 failure mode. \`>=\` bakes in no
    // figure at all, so it can never disagree with a future dust size.
    //
    // CONSEQUENCE, and it is not optional: PADDING an input above the dust stays legal (self-funded, locked in,
    // harms nobody), so a builder that emits a bare constant against a padded reserve produces an ILLEGAL
    // continuation and wedges the token permanently. Builders MUST emit max(COVENANT_DUST, inputValue) —
    // \`continuationValue\` in web/src/covenantSelect.ts. Both directions are VM-proven in
    // tools/poc-token-output-value-continuation.mjs, which runs the shave against the archived pre-fix schema
    // (ACCEPTED, the historical defect) and against these sources (REJECTED, the fix).
    int constant ORDER_TX_FEE = 20000000;       // bounded share consumed only as the keyless batch tx fee
    int constant MAX_FEE_BPS = 2000;           // every baked fee bps ≤ this so value·bps stays int64-safe at MAX_KAS
    int constant MAX_LOCKED_SHARES = 1000000;  // 1e6 — pool floor shares bound (pool lpFee·lockedShares int64-safe)
    int constant MAX_INIT_OUTS = 8;            // upper bound on init tx outputs (honest = [curve,inv,dev,change]=4)
    int constant MAX_GRAD_OUTS = 8;            // bounded full-output scan for the new pool authority P

    // Baked fee bps are int64-safe iff each ≤ MAX_FEE_BPS: a fee output computes value·bps/10000 with value ≤
    // MAX_KAS=9e14, so value·bps ≤ 9e14·2000 = 1.8e18 (≈5× under 2^63). Checked on every fee-bearing spend.
    function feesOk(): bool {
        return creatorFeeBps >= 0 && creatorFeeBps <= MAX_FEE_BPS
            && platformFeeBps >= 0 && platformFeeBps <= MAX_FEE_BPS
            && graduationFeeBps >= 0 && graduationFeeBps <= MAX_FEE_BPS
            && devFundBps >= 0 && devFundBps <= MAX_FEE_BPS;
    }

    function soleCurveContinuation(): byte[32] {
        byte[32] self = OpInputCovenantId(this.activeInputIndex);
        require(OpCovOutputCount(self) == 1);
        require(OpCovOutputIdx(self, 0) == SELF_OUT);
        return self;
    }

    // ---- init: genesis-bind C↔A and pre-mint the whole supply (inventory + dev allocation) ----------
    // The init tx spends the (still-unbound) curve and creates covid A's genesis outputs: the C-owned
    // inventory and the creator's dev allocation. A = their KIP-20 genesis id. No minter branch is created,
    // so no more A can ever be minted — supply is fixed at inventory+dev forever.
    entrypoint function init(int initializerWitness, TokenState inventory, TokenState devAlloc) {
        require(tokenCovid == ZERO_COVID);
        // Every other entrypoint bounds the baked fee bps; init did not. A curve deployed with out-of-range fee
        // parameters would initialise cleanly, mint the full supply, and then revert on EVERY trade — a dead
        // token with a burned launch fee and no way back, because the parameters are baked into the address.
        require(feesOk());
        require(initializerWitness >= 0 && initializerWitness < tx.inputs.length);
        require(tx.inputs[initializerWitness].scriptPubKey == new ScriptPubKeyP2PK(creatorFeeOwner));
        byte[32] boundA = OpOutputCovenantId(INIT_INV_OUT);
        require(boundA != ZERO_COVID);
        // KRN-H2: prove A is a GENESIS id, not a CONTINUATION of a token the creator minted earlier and still
        // holds elsewhere. The stray-output scan below forbids extra covid-A outputs in THIS transaction, but a
        // continuation's supply lives outside it entirely — bind a pre-minted token here and the creator keeps
        // the rest off-transaction, then sells it into their own curve. That defeats the guarantee this
        // covenant's own header makes: supply fixed at inventory + dev allocation, mint renounced from block
        // one. A continuation is impossible without an input carrying the id, so zero inputs ⇒ genesis.
        require(OpCovInputCount(boundA) == 0);
        require(OpOutputCovenantId(INIT_DEV_OUT) == boundA);

        // C-1 (CRITICAL): genesis supply integrity. Consensus lets the deployer add EXTRA covid-A genesis outputs
        // to the same (authorizing-input, A) group — a hidden minter branch or a pre-mined balance — and they are
        // INVISIBLE to OpCovOutputCount (genesis groups never populate the script context). So scan EVERY output
        // and forbid covid A anywhere except the inventory (idx 1) and dev (idx 2). Non-covenant outputs (P2PK
        // change/fee) report ZERO; the curve continuation (idx 0) reports C != A. Without this, an init that
        // validates only outputs 1 & 2 lets a 3rd covid-A output survive ⇒ supply is NOT fixed (mint not renounced).
        int nOut = tx.outputs.length;
        require(nOut <= MAX_INIT_OUTS);
        for (i, 0, nOut, MAX_INIT_OUTS) {
            if (i != INIT_INV_OUT && i != INIT_DEV_OUT) {
                require(OpOutputCovenantId(i) != boundA);
            }
        }

        byte[32] self = soleCurveContinuation();
        // inventory: owned by THIS curve's covenant-id C, real (non-minter), holds the sellable supply
        require(inventory.ownerIdentifier == self);
        require(inventory.identifierType == IDENTIFIER_COVENANT_ID);
        require(!inventory.isMinter);
        require(inventory.amount >= 1 && inventory.amount <= MAX_TOKEN);
        // dev allocation: presence-owned by the creator (displayed on-chain), real (non-minter). Bounded to
        // [1, MAX_TOKEN] — genesis outputs SKIP kcc20's per-balance amount checks (those run
        // only when a UTXO is later spent), so without this bound init could stamp a dev balance of 0 (a stuck
        // dead UTXO) or > MAX_TOKEN, breaking the advertised fixed-supply cap and the per-balance int64 sum bound.
        require(devAlloc.ownerIdentifier == creatorIdentifier);
        require(devAlloc.identifierType == IDENTIFIER_ADDRESS);
        require(!devAlloc.isMinter);
        require(devAlloc.amount >= 1 && devAlloc.amount <= MAX_TOKEN);
        // Lineage-wide cap. Subtraction is safe after the positive individual bounds above and avoids an
        // attacker-controlled addition becoming the security predicate.
        require(inventory.amount <= MAX_TOKEN - devAlloc.amount);
        // genesis outputs are validated by DIRECT index (OpCovOutputIdx only sees CONTINUED covid groups, not
        // the genesis outputs being created here — their group count is 0 until they're later spent).
        validateOutputStateWithTemplate(INIT_INV_OUT, inventory, tokPrefix, tokSuffix, tokTemplateHash);
        validateOutputStateWithTemplate(INIT_DEV_OUT, devAlloc, tokPrefix, tokSuffix, tokTemplateHash);

        // bind A into the curve continuation (value carries over unchanged)
        require(tx.outputs[SELF_OUT].value == tx.inputs[this.activeInputIndex].value);
        // commit the genesis token reserve into state (== the C-owned inventory just minted). From here buy/sell
        // read the reserve from state, never from an input, so it cannot be spoofed.
        validateOutputState(SELF_OUT, { graduated: graduated, tokenCovid: boundA, tokenReserve: inventory.amount });
    }

    // ---- buy: trader adds kasIn into the reserve (+ a 1% fee) and receives tokenOut from inventory --------
    entrypoint function buy(int kasIn, int tokenOut, TokenState inventoryOut, TokenState buyerOut) {
        require(!graduated);
        require(tokenCovid != ZERO_COVID);
        require(feesOk());                              // int64-safety: bound the baked fee bps

        int realKas = tx.inputs[this.activeInputIndex].value;
        require(realKas >= 0 && realKas <= MAX_KAS);
        int ru = realKas / SCALE;
        require(ru * SCALE == realKas);                 // curve value is always a whole number of SCALE units
        require(kasIn > 0);
        int ki = kasIn / SCALE;
        require(ki * SCALE == kasIn);                   // buys move the reserve in SCALE-unit steps
        require(vKas >= 1 && vKas <= MAX_UNITS);

        // SECURITY (reserve-spoof fix): the token reserve is AUTHORITATIVE from committed state — NEVER read from an
        // input (input[1] is attacker-chosen). We still read the inventory input, but only to PIN it to the curve's
        // own C-owned UTXO whose amount equals the committed reserve, so the REAL inventory is provably the one spent.
        require(tokenReserve >= 1 && tokenReserve <= MAX_TOKEN);
        require(tokenOut > 0 && tokenOut < tokenReserve);
        byte[32] self = soleCurveContinuation();
        TokenState invIn = readInputStateWithTemplate(INVENTORY_IN, tokPrefixLen, tokSuffixLen, tokTemplateHash);
        // The template authenticates the SHAPE of the input, not its identity — the kcc20 template is the same
        // for every token sharing (maxIns, maxOuts). Committed state + conservation already force the genuine
        // inventory here, but this guard reads as load-bearing, so make it actually be so.
        require(OpInputCovenantId(INVENTORY_IN) == tokenCovid);
        require(invIn.ownerIdentifier == self);
        require(invIn.identifierType == IDENTIFIER_COVENANT_ID);
        require(invIn.amount == tokenReserve);

        int newKas = realKas + kasIn;
        // Overbuy allowed: a buy MAY push the raise past graduationKas. The buyer keeps the constant-product
        // tokens for the whole kasIn, and at graduation 95% of the (now larger) raise seeds the locked LP — so
        // the excess becomes pool liquidity. Bounded only by MAX_KAS so the curve UTXO value stays int64-safe
        // and graduate() (which requires realKas <= MAX_KAS) can still run.
        require(newKas <= MAX_KAS);                     // overbuy allowed up to the int64-safety ceiling
        int nu = ru + ki;
        require(nu <= MAX_UNITS);
        int newToken = tokenReserve - tokenOut;
        // constant-product floor: the curve keeps ≥ the CP tokens, so the buyer can't over-extract
        require((vKas + nu) * newToken >= (vKas + ru) * tokenReserve);

        // (1) curve continuation — KAS reserve grows by kasIn; the committed token reserve shrinks to newToken
        require(tx.outputs[SELF_OUT].value == newKas);
        validateOutputState(SELF_OUT, { graduated: false, tokenCovid: tokenCovid, tokenReserve: newToken });

        // (2) inventory shrinks, buyer is paid — the buyer's bought tokens MERGED with any EXISTING holdings the
        // buyer inputs (covid-A) into ONE output, so a buy never fragments (mirrors amm_pool_cp_v3 merge-in-buy).
        // kcc20 conservation forces buyerOut == tokenOut + Σ(merged existing); the inventory (pinned to newToken)
        // fixes how much the buyer actually bought, so the excess can only be their OWN tokens.
        require(OpCovOutputCount(tokenCovid) == 2);      // exactly [0]=inventory, [1]=the ONE merged buyer output
        require(inventoryOut.ownerIdentifier == self);
        require(inventoryOut.identifierType == IDENTIFIER_COVENANT_ID);
        require(inventoryOut.amount == newToken);
        require(!inventoryOut.isMinter);
        require(buyerOut.amount >= tokenOut);            // == tokenOut + Σ(buyer's merged existing tokens), kcc20-pinned
        require(buyerOut.identifierType == IDENTIFIER_ADDRESS);   // presence-owned → the buyer can sell it later
        require(!buyerOut.isMinter);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 0), inventoryOut, tokPrefix, tokSuffix, tokTemplateHash);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 1), buyerOut, tokPrefix, tokSuffix, tokTemplateHash);

        // VALUE CONTINUATION (findings row 14). The covenant-owned token output's native KAS was previously
        // unconstrained, so any spender could shave it — VM-proven in tools/poc-token-output-value-continuation.mjs.
        // This is RELATIVE, never an absolute dust constant: baking a constant into an immutable redeem is the
        // KRN-C4 failure mode (a later change to builder dust sizing would brick every launched token forever),
        // whereas \`>=\` bakes in no figure at all and so can never disagree with a future dust size. Shaving is
        // now impossible; PADDING stays legal and is self-punishing — the padder funds it and it is locked in
        // permanently, harming nobody. Builders must therefore emit max(COVENANT_DUST, inputValue), NOT a bare
        // constant, or an over-funded reserve would make the honest continuation illegal and wedge the token.
        require(tx.outputs[OpCovOutputIdx(tokenCovid, 0)].value >= tx.inputs[INVENTORY_IN].value);

        // (3) trade fee, split creator / platform / dev fund
        int creatorFee = kasIn * creatorFeeBps / 10000;
        int platformFee = kasIn * platformFeeBps / 10000;
        int devFundFee = kasIn * devFundBps / 10000;
        require(tx.outputs[BUY_CREATOR_FEE_OUT].scriptPubKey == new ScriptPubKeyP2PK(creatorFeeOwner));
        require(tx.outputs[BUY_CREATOR_FEE_OUT].value >= creatorFee);
        require(tx.outputs[BUY_PLATFORM_FEE_OUT].scriptPubKey == new ScriptPubKeyP2PK(platformFeeOwner));
        require(tx.outputs[BUY_PLATFORM_FEE_OUT].value >= platformFee);
        require(tx.outputs[BUY_DEV_FEE_OUT].scriptPubKey == new ScriptPubKeyP2PK(devFundOwner));
        require(tx.outputs[BUY_DEV_FEE_OUT].value >= devFundFee);
    }

    // ---- sell (single-token, FRACTIONAL): the seller folds \`tokenIn\` into the inventory, gets kasOut (− 1% fee),
    // and receives the UNSOLD remainder back as one presence-owned change output — no pre-split tx needed (mirrors
    // amm_pool_cp_v3.swapTokenForKas). input[1] = the curve's C-owned inventory; input[2..] = the seller's token
    // piece(s), each authorized by a co-present P2PK input (kcc20 §5b). The covid-A group is conserved by kcc20, so
    // the covenant never reads the seller inputs: it pins the inventory (fold amount) + the CP price, and kcc20
    // forces change == Σ(seller inputs) − tokenIn. covid-A outputs: [0]=grown inventory (C), OPTIONAL [1]=change.
    entrypoint function sell(int tokenIn, int kasOut, TokenState inventoryOut, TokenState traderChangeOut) {
        require(!graduated);
        require(tokenCovid != ZERO_COVID);
        require(feesOk());                              // int64-safety: bound the baked fee bps

        int realKas = tx.inputs[this.activeInputIndex].value;
        require(realKas >= 0 && realKas <= MAX_KAS);
        int ru = realKas / SCALE;
        require(ru * SCALE == realKas);
        require(kasOut > 0);
        int ko = kasOut / SCALE;
        require(ko * SCALE == kasOut);
        require(vKas >= 1 && vKas <= MAX_UNITS);

        require(tokenIn > 0);
        // SECURITY (reserve-spoof fix): the token reserve is AUTHORITATIVE from committed state — NOT from input[1]
        // (an attacker could present a tiny decoy there to make the k-floor trivial and drain the KAS reserve). Pin
        // the inventory input to the curve's own C-owned UTXO whose amount equals the committed reserve.
        require(tokenReserve >= 1 && tokenReserve <= MAX_TOKEN);
        byte[32] self = soleCurveContinuation();
        TokenState invIn = readInputStateWithTemplate(SELL_INVENTORY_IN, tokPrefixLen, tokSuffixLen, tokTemplateHash);
        require(OpInputCovenantId(SELL_INVENTORY_IN) == tokenCovid);
        require(invIn.ownerIdentifier == self);
        require(invIn.identifierType == IDENTIFIER_COVENANT_ID);
        require(invIn.amount == tokenReserve);

        int newKas = realKas - kasOut;
        require(newKas >= 0);
        int nu = ru - ko;
        int newToken = tokenReserve + tokenIn;
        require(newToken <= MAX_TOKEN);
        // constant-product floor: after refund the curve still holds ≥ k, so the seller can't drain it
        require((vKas + nu) * newToken >= (vKas + ru) * tokenReserve);

        // (1) curve continuation — KAS reserve shrinks by kasOut; the committed token reserve grows to newToken
        require(tx.outputs[SELF_OUT].value == newKas);
        validateOutputState(SELF_OUT, { graduated: false, tokenCovid: tokenCovid, tokenReserve: newToken });

        // (2) tokenIn folds into the C-owned inventory (covid-A output 0); the seller's unsold remainder returns as an
        // OPTIONAL presence-owned change output (covid-A output 1). kcc20 conservation forces change == Σseller − tokenIn,
        // and the fold amount (tokenIn) is pinned via inventoryOut.amount + the CP floor, so the seller takes KAS only
        // for what's folded and can only ever receive their OWN tokens back.
        int nTokOut = OpCovOutputCount(tokenCovid); // [0]=grown inventory, OPTIONAL [1]=trader change
        require(nTokOut >= 1 && nTokOut <= 2);
        require(inventoryOut.ownerIdentifier == self);
        require(inventoryOut.identifierType == IDENTIFIER_COVENANT_ID);
        require(inventoryOut.amount == newToken);
        require(!inventoryOut.isMinter);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 0), inventoryOut, tokPrefix, tokSuffix, tokTemplateHash);
        require(tx.outputs[OpCovOutputIdx(tokenCovid, 0)].value >= tx.inputs[SELL_INVENTORY_IN].value);   // value continuation — see buy
        if (nTokOut == 2) {
            require(traderChangeOut.amount >= 1 && traderChangeOut.amount <= MAX_TOKEN);
            require(traderChangeOut.identifierType == IDENTIFIER_ADDRESS);   // presence-owned → the seller keeps the remainder
            require(!traderChangeOut.isMinter);
            validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 1), traderChangeOut, tokPrefix, tokSuffix, tokTemplateHash);
        }

        // (3) trade fee on the refund, split creator / platform / dev fund (paid from the freed reserve)
        int creatorFee = kasOut * creatorFeeBps / 10000;
        int platformFee = kasOut * platformFeeBps / 10000;
        int devFundFee = kasOut * devFundBps / 10000;
        require(tx.outputs[SELL_CREATOR_FEE_OUT].scriptPubKey == new ScriptPubKeyP2PK(creatorFeeOwner));
        require(tx.outputs[SELL_CREATOR_FEE_OUT].value >= creatorFee);
        require(tx.outputs[SELL_PLATFORM_FEE_OUT].scriptPubKey == new ScriptPubKeyP2PK(platformFeeOwner));
        require(tx.outputs[SELL_PLATFORM_FEE_OUT].value >= platformFee);
        require(tx.outputs[SELL_DEV_FEE_OUT].scriptPubKey == new ScriptPubKeyP2PK(devFundOwner));
        require(tx.outputs[SELL_DEV_FEE_OUT].value >= devFundFee);
    }

    // ---- graduate: permissionless once realKas ≥ graduationKas ------------------------------------------
    // Locks the curve, seeds an AMM pool with 95% of the raised KAS + the entire leftover inventory (pool
    // liquidity is permanently locked — amm_pool_native has no removal entrypoint), and pays the platform a
    // 5% graduation fee. The leftover inventory moves to the pool's covenant-id P (the only covid-A output).
    entrypoint function graduate(PoolState pool, TokenState poolTokens) {
        require(!graduated);
        require(tokenCovid != ZERO_COVID);
        require(feesOk());                                              // int64-safety: bound graduationFeeBps
        require(poolLockedShares >= 1 && poolLockedShares <= MAX_LOCKED_SHARES); // bound the seeded floor shares

        int realKas = tx.inputs[this.activeInputIndex].value;
        require(realKas >= graduationKas);
        require(realKas <= MAX_KAS);

        // The pool seeds with \`poolKas\` (a whole number of SCALE units, set by the pool genesis); the platform
        // takes the remainder, which must be AT LEAST graduationFeeBps of the raise. (Taking the remainder
        // rather than an exact %% keeps poolKas SCALE-aligned without a divisibility headache.)
        int poolKas = pool.kasReserve * SCALE;
        require(poolKas >= 1 && poolKas <= MAX_KAS);
        int gradFee = realKas - poolKas;
        require(gradFee >= 0);
        require(gradFee * 10000 >= realKas * graduationFeeBps);          // platform fee is AT LEAST graduationFeeBps
        // M1 (security audit): bound the fee from ABOVE too, so the pool can't be under-seeded. Without this a
        // permissionless graduate could divert ~all the raise into the platform fee and seed a dust-KAS pool,
        // letting a griefer scoop the pooled inventory for ~nothing. The honest builder floors poolKas to a
        // whole SCALE step (≤ graduationFeeBps fee), so the real fee is within ~one SCALE unit above the exact
        // fee; allow 2·SCALE of slack. ⇒ the pool always receives ≥ ~(100−graduationFeeBps)% of the raise.
        require(gradFee * 10000 <= realKas * graduationFeeBps + 2 * SCALE * 10000);

        // SECURITY (reserve-spoof fix): the leftover inventory is AUTHORITATIVE from committed state — NOT read from
        // input[1]. Pin the inventory input to the curve's own C-owned UTXO whose amount equals the committed reserve,
        // so an attacker can't present a decoy to under-seed the pool and strand (burn) the real leftover inventory.
        int leftover = tokenReserve;
        require(leftover >= 1 && leftover <= MAX_TOKEN);
        byte[32] self = soleCurveContinuation();
        TokenState invIn = readInputStateWithTemplate(INVENTORY_IN, tokPrefixLen, tokSuffixLen, tokTemplateHash);
        require(OpInputCovenantId(INVENTORY_IN) == tokenCovid);
        require(invIn.ownerIdentifier == self);
        require(invIn.identifierType == IDENTIFIER_COVENANT_ID);
        require(invIn.amount == tokenReserve);

        // (1) one-way lock the curve (value left as dust carries in tx.outputs[SELF_OUT])
        validateOutputState(SELF_OUT, { graduated: true, tokenCovid: tokenCovid, tokenReserve: tokenReserve });

        // (2) seed the pool genesis with poolKas (≈95% of the reserve) and the leftover inventory
        require(pool.tokenReserve == leftover);
        require(pool.tokenCovid == tokenCovid);
        require(pool.totalShares == poolLockedShares);   // v2: seed the locked floor; pool.bindLp later mints L to match
        require(pool.lpCovid == ZERO_COVID);             // v2: L unbound at graduation (bound post-grad by bindLp)
        require(tx.outputs[POOL_OUT].value == poolKas);
        validateOutputStateWithTemplate(POOL_OUT, pool, poolPrefix, poolSuffix, poolTemplateHash);

        // P is a bearer capability over the seeded reserves. Prove the validated pool output is the only output
        // carrying this newly derived genesis id; genesis groups are not visible through OpCovOutputCount.
        byte[32] poolP = OpOutputCovenantId(POOL_OUT);
        require(poolP != ZERO_COVID && poolP != self);
        int nOut = tx.outputs.length;
        require(nOut <= MAX_GRAD_OUTS);
        for (i, 0, nOut, MAX_GRAD_OUTS) {
            if (i != POOL_OUT) {
                require(OpOutputCovenantId(i) != poolP);
            }
        }

        // (3) move the leftover inventory into the pool's covenant-id P (sole covid-A output)
        require(OpCovOutputCount(tokenCovid) == 1);
        require(poolTokens.ownerIdentifier == poolP);
        require(poolTokens.identifierType == IDENTIFIER_COVENANT_ID);
        require(poolTokens.amount == leftover);
        require(!poolTokens.isMinter);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 0), poolTokens, tokPrefix, tokSuffix, tokTemplateHash);
        require(tx.outputs[OpCovOutputIdx(tokenCovid, 0)].value >= tx.inputs[INVENTORY_IN].value);   // value continuation — see buy

        // (4) platform graduation fee
        require(tx.outputs[GRAD_FEE_OUT].scriptPubKey == new ScriptPubKeyP2PK(platformFeeOwner));
        require(tx.outputs[GRAD_FEE_OUT].value >= gradFee);
    }

    // ---- batchBuy: atomically settle 2..4 refundable buyer orders at one aggregate CP price. -----------
    // inputs [0]=curve [1]=inventory [2..]=orders; token outputs [inventory,buyer...], then three fee outputs.
    // Declared last; batchBuy = selector 4. (It was 5 while the removed \`initVested\` occupied slot 4 — tokens
    // pinned to those schemas keep the old map, so builders resolve the selector from the template, not a const.)
    entrypoint function batchBuy(int count, TokenState inventoryOut) {
        require(this.activeInputIndex == 0);
        require(!graduated && tokenCovid != ZERO_COVID && feesOk());
        require(count >= 2 && count <= 4);
        require(tx.outputs.length == count + 5); // curve + (inventory,buyers) + three fees; no fee-buffer skimming output
        int realKas = tx.inputs[this.activeInputIndex].value;
        require(realKas >= 0 && realKas <= MAX_KAS && realKas / SCALE * SCALE == realKas);
        require(vKas >= 1 && vKas <= MAX_UNITS && tokenReserve >= 1 && tokenReserve <= MAX_TOKEN);
        byte[32] self = soleCurveContinuation();
        TokenState invIn = readInputStateWithTemplate(INVENTORY_IN, tokPrefixLen, tokSuffixLen, tokTemplateHash);
        require(OpInputCovenantId(INVENTORY_IN) == tokenCovid);
        require(invIn.ownerIdentifier == self && invIn.identifierType == IDENTIFIER_COVENANT_ID);
        require(!invIn.isMinter && invIn.amount == tokenReserve);
        require(OpCovOutputCount(tokenCovid) == count + 1);

        int totalKas = 0;
        int totalUnits = 0;   // same total in SCALE units — see the proportional split below for why
        int creatorFees = 0;
        int platformFees = 0;
        int devFundFees = 0;
        for (i, 0, count, 4) {
            OrderState order = readInputStateWithTemplate(2 + i, orderPrefixLen, orderSuffixLen, orderTemplateHash);
            require(order.curveCovid == self && order.buyerIdentifier != ZERO_COVID);
            require(order.kasIn >= MIN_ORDER_KAS && order.kasIn / SCALE * SCALE == order.kasIn);
            require(order.kasIn <= MAX_KAS - realKas - totalKas);
            require(order.minTokenOut >= 1 && order.minTokenOut <= MAX_TOKEN);
            int creatorFee = order.kasIn * creatorFeeBps / 10000;
            int platformFee = order.kasIn * platformFeeBps / 10000;
            int devFundFee = order.kasIn * devFundBps / 10000;
            if (creatorFee < FEE_OUT_MIN) { creatorFee = FEE_OUT_MIN; }
            if (platformFee < FEE_OUT_MIN) { platformFee = FEE_OUT_MIN; }
            if (devFundFee < FEE_OUT_MIN) { devFundFee = FEE_OUT_MIN; }
            require(tx.inputs[2 + i].value == order.kasIn + ORDER_TOKEN_DUST + creatorFee + platformFee + devFundFee + ORDER_TX_FEE);
            totalKas = totalKas + order.kasIn;
            totalUnits = totalUnits + order.kasIn / SCALE;
            creatorFees = creatorFees + creatorFee;
            platformFees = platformFees + platformFee;
            devFundFees = devFundFees + devFundFee;
        }

        int newKas = realKas + totalKas;
        int newToken = inventoryOut.amount;
        require(newToken >= 1 && newToken < tokenReserve);
        require((vKas + newKas / SCALE) * newToken >= (vKas + realKas / SCALE) * tokenReserve);
        require(tx.outputs[SELF_OUT].value == newKas);
        validateOutputState(SELF_OUT, { graduated: false, tokenCovid: tokenCovid, tokenReserve: newToken });
        require(inventoryOut.ownerIdentifier == self && inventoryOut.identifierType == IDENTIFIER_COVENANT_ID);
        require(!inventoryOut.isMinter && inventoryOut.amount == newToken);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, 0), inventoryOut, tokPrefix, tokSuffix, tokTemplateHash);
        require(tx.outputs[OpCovOutputIdx(tokenCovid, 0)].value == ORDER_TOKEN_DUST);
        // KRN-H1: bind each buyer's TOKEN amount to their share of the input. Without this the covenant enforced
        // the constant-product invariant only in AGGREGATE and pinned each buyer output's KAS dust, but never
        // their token amount — the only per-buyer constraint lived in buy_order.sil and it is a FLOOR
        // (\`buyerOut.amount >= minTokenOut\`). Whoever builds the batch chooses the split, batchBuy is
        // permissionless, and the pending queue (with every order's stated minimum) is served unauthenticated —
        // so a settler could hand each honest buyer exactly their minimum and take the whole remaining surplus
        // into their own slot. Pro-rata allocation existed only as a convention in the first-party client.
        //
        // int64 safety: the share is computed in SCALE UNITS, not sompi. totalTokenOut ≤ MAX_TOKEN = 1e9 and a
        // single order's units ≤ MAX_UNITS = 9e8, so the product ≤ 9e17 — comfortably under 2^63 (≈9.22e18).
        // In sompi it would be 1e9 · 9e14 = 9e23 and would overflow. Each order's kasIn is already required to
        // be SCALE-aligned above, so the division is exact and loses nothing.
        int totalTokenOut = tokenReserve - newToken;
        require(totalUnits >= 1);
        int allocated = 0;
        for (i, 0, count, 4) {
            OrderState order = readInputStateWithTemplate(2 + i, orderPrefixLen, orderSuffixLen, orderTemplateHash);
            // floor(totalTokenOut · orderUnits / totalUnits); the LAST slot absorbs the rounding remainder so
            // the sum is exactly totalTokenOut and no dust can be diverted.
            int share = totalTokenOut * (order.kasIn / SCALE) / totalUnits;
            if (i == count - 1) { share = totalTokenOut - allocated; }
            allocated = allocated + share;
            require(share >= order.minTokenOut);   // the buyer's own slippage floor still applies
            validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, i + 1),
                { ownerIdentifier: order.buyerIdentifier, identifierType: IDENTIFIER_ADDRESS, amount: share, isMinter: false },
                tokPrefix, tokSuffix, tokTemplateHash);
            require(tx.outputs[OpCovOutputIdx(tokenCovid, i + 1)].value == ORDER_TOKEN_DUST);
        }
        require(allocated == totalTokenOut);   // every bought token is accounted to a buyer
        require(tx.outputs[count + 2].scriptPubKey == new ScriptPubKeyP2PK(creatorFeeOwner));
        require(tx.outputs[count + 2].value == creatorFees);
        require(tx.outputs[count + 3].scriptPubKey == new ScriptPubKeyP2PK(platformFeeOwner));
        require(tx.outputs[count + 3].value == platformFees);
        require(tx.outputs[count + 4].scriptPubKey == new ScriptPubKeyP2PK(devFundOwner));
        require(tx.outputs[count + 4].value == devFundFees);
    }
}
`;export{e as default};
