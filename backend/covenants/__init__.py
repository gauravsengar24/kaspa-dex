"""On-chain HTLC covenant swaps on Kaspa L1 (KIP-17 / Toccata).

A Hash Time-Locked Contract enforced entirely by a Kaspa covenant script:
  CLAIM  - reveal secret s (blake2b(s) == H) + taker signature. Immediate.
  REFUND - maker signature, only after timeout DAA (OpTxLockTime + CSV guard).

This makes the KAS leg of a swap non-custodial: the DEX can only take the
locked funds by revealing the secret on-chain, and the maker can always
refund after the timeout.
"""
