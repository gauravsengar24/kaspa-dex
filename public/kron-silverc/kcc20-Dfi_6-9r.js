const n=`pragma silverscript ^0.1.0;

// KRON native-L1 covenant fungible token (KCC-20) — NO rollup, NO Kasplex. Upgraded to match the
// reference standard documented in the KCC-20 book
// (projX/silverscript/docs/kcc20-book/, kaspanet.github.io/silverscript/kcc20-book).
//
// Each token balance is a covenant UTXO with 4-field state:
//   ownerIdentifier : byte[32]  — the owner's identity (meaning depends on identifierType)
//   identifierType  : byte      — 0x00 pubkey · 0x01 P2SH script-hash · 0x02 covenant-id · 0x03 address (presence)
//   amount          : int       — token balance
//   isMinter        : bool      — mint/burn authority for this branch
//
// \`transfer\` is the only way a token UTXO moves. It:
//   1. AUTHORIZES every covenant input per its ownership mode (checkSigs): a pubkey-owned balance needs a
//      signature; a script-hash-owned balance needs a matching P2SH input in the tx; a covenant-id-owned
//      balance needs an input carrying that covenant id (the curve/pool own balances this way — no sig); an
//      address-owned (presence) balance needs a co-present input at the owner's P2PK address (MIGRATION §5b).
//   2. Validates each output's full state via the covenant-id group (OpCovOutputIdx + validateOutputState).
//   3. Enforces CONSERVATION (sum in == sum out) AND forbids creating new minter branches — UNLESS the
//      active branch isMinter, which is the only way supply may grow (mint) or shrink (burn).
// This is the same supply-integrity Kasplex enforces with an off-chain indexer, here on L1 consensus
// (KIP-17 introspection + KIP-20 covenant IDs).
contract Kcc20(int maxIns, int maxOuts, byte[32] initOwner, byte initIdentifierType, int initAmount, bool initIsMinter) {
    byte constant IDENTIFIER_PUBKEY = 0x00;
    byte constant IDENTIFIER_SCRIPT_HASH = 0x01;
    byte constant IDENTIFIER_COVENANT_ID = 0x02;
    byte constant IDENTIFIER_ADDRESS = 0x03;
    // Per-balance upper bound (defense-in-depth): KRON genesis fixes total supply ≤ 1e9 and conservation holds it
    // there, but as a reusable asset standard kcc20 must bound each balance so summing \`maxIns\` inputs can never
    // overflow int64 (≈9.22e18) and let a wrapped \`inSum == outSum\` mint supply. 1e9 matches curve_cp/pool MAX_TOKEN.
    int constant MAX_TOKEN = 1000000000;

    byte[32] ownerIdentifier = initOwner;
    byte identifierType = initIdentifierType;
    int amount = initAmount;
    bool isMinter = initIsMinter;

    entrypoint function transfer(State[] newStates, sig[] sigs, byte[] witnesses) {
        require(newStates.length >= 1 && newStates.length <= maxOuts);
        byte[32] covid = OpInputCovenantId(this.activeInputIndex);

        int inCount = OpCovInputCount(covid);
        require(inCount >= 1 && inCount <= maxIns);
        require(OpCovOutputCount(covid) == newStates.length);

        // authorize every covenant input per its ownership mode, summing input amounts
        int inSum = 0;
        for (i, 0, inCount, maxIns) {
            { ownerIdentifier: byte[32] o, identifierType: byte t, amount: int a, isMinter: bool m } = readInputState(OpCovInputIdx(covid, i));
            if (t == IDENTIFIER_PUBKEY) {
                require(checkSig(sigs[i], o));
            } else if (t == IDENTIFIER_SCRIPT_HASH) {
                require(tx.inputs[witnesses[i]].scriptPubKey == new ScriptPubKeyP2SH(o));
            } else if (t == IDENTIFIER_COVENANT_ID) {
                require(OpInputCovenantId(witnesses[i]) == o);
            } else if (t == IDENTIFIER_ADDRESS) {
                // presence-based ownership (MIGRATION §5b): spendable iff the tx carries a co-present input
                // at the owner's P2PK address — which an existing wallet (Kasware signPskt) signs externally.
                // The token UTXO itself needs no in-script signature, so sell/transfer work without the
                // wallet ever signing the covenant P2SH input. (Same shape as the script-hash branch.)
                require(tx.inputs[witnesses[i]].scriptPubKey == new ScriptPubKeyP2PK(o));
            } else {
                require(false);
            }
            // Non-negativity guard on inputs (KCC-20 conservation). \`amount\` is signed, so summing inputs without
            // this lets a spend pair a +X and a −X input to fake \`inSum == outSum\` and mint from nothing. The
            // output loop already rejects negative outputs (amount >= 1), which makes the class unreachable on-chain
            // by lineage (every input was a prior bounded output); checking inputs directly makes conservation
            // LOCALLY provable without relying on that invariant. 0 is allowed so a zero-amount minter-branch input
            // still spends. Mirrors the community KCC-20 spec's "amount >= 0 on every in/out" rule.
            require(a >= 0);
            inSum = inSum + a;
        }

        // validate every output's full state and sum output amounts
        int outSum = 0;
        for (i, 0, newStates.length, maxOuts) {
            // A balance must hold >= 1 token, EXCEPT a minter branch — a pure mint-authority capability
            // that legitimately holds 0 (the curve recreates its 0-amount C-owned minter branch on every
            // buy). Without this carve-out the buy's minter-branch transfer fails on-chain (require(0 >= 1))
            // even though the curve requires that recreated branch to be amount == 0. Negatives stay rejected.
            require(newStates[i].amount >= 1 || (newStates[i].isMinter && newStates[i].amount == 0));
            require(newStates[i].amount <= MAX_TOKEN);   // upper bound → per-balance cap keeps Σ inputs int64-safe
            outSum = outSum + newStates[i].amount;
            validateOutputState(OpCovOutputIdx(covid, i), newStates[i]);
        }

        // ordinary (non-minter) branches must conserve supply and may not create minter branches;
        // minter branches may grow (mint) or shrink (burn) the total.
        if (!isMinter) {
            require(inSum == outSum);
            for (i, 0, newStates.length, maxOuts) {
                require(!newStates[i].isMinter);
            }
        }
    }
}
`;export{n as default};
