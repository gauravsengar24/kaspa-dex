const e=`pragma silverscript ^0.1.0;

// Refundable asynchronous buy intent. Settlement delegates only to the exact curve named in state; that
// curve validates aggregate price, escrow, conservation and fees; this order validates its recipient/minimum. Cancellation
// returns the complete escrow and requires a co-present buyer P2PK input, so only the buyer can revoke it.
contract BuyOrder(
    byte[] tokPrefix,
    byte[] tokSuffix,
    byte[32] tokTemplateHash,
    byte[32] initCurveCovid,
    byte[32] initBuyerIdentifier,
    int initKasIn,
    int initMinTokenOut
) {
    byte[32] curveCovid = initCurveCovid;
    byte[32] buyerIdentifier = initBuyerIdentifier;
    int kasIn = initKasIn;
    int minTokenOut = initMinTokenOut;

    struct TokenState {
        byte[32] ownerIdentifier;
        byte identifierType;
        int amount;
        bool isMinter;
    }
    byte constant IDENTIFIER_ADDRESS = 0x03;

    entrypoint function settle(int slot, TokenState buyerOut) {
        require(slot >= 0 && slot < 4);
        require(this.activeInputIndex == 2 + slot);
        require(OpInputCovenantId(0) == curveCovid);
        require(buyerIdentifier != 0x0000000000000000000000000000000000000000000000000000000000000000);
        require(minTokenOut >= 1 && buyerOut.amount >= minTokenOut);
        require(buyerOut.ownerIdentifier == buyerIdentifier && buyerOut.identifierType == IDENTIFIER_ADDRESS);
        require(!buyerOut.isMinter);
        byte[32] tokenCovid = OpInputCovenantId(1);
        require(OpCovOutputCount(tokenCovid) >= 3 && OpCovOutputCount(tokenCovid) <= 5);
        validateOutputStateWithTemplate(OpCovOutputIdx(tokenCovid, slot + 1), buyerOut, tokPrefix, tokSuffix, tokTemplateHash);
    }

    entrypoint function refund(int buyerWitness) {
        require(buyerWitness >= 0 && buyerWitness < tx.inputs.length);
        require(tx.inputs[buyerWitness].scriptPubKey == new ScriptPubKeyP2PK(buyerIdentifier));
        require(tx.outputs[0].scriptPubKey == new ScriptPubKeyP2PK(buyerIdentifier));
        require(tx.outputs[0].value == tx.inputs[this.activeInputIndex].value);
    }
}
`;export{e as default};
