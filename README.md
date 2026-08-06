---
title: Aetheris — Uniframe DeFi & GameFi on Kaspa
emoji: 💠
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# Aetheris — Uniframe DeFi & GameFi on Kaspa

State-first interface over Kaspa L1 covenants. The browser reads on-chain state
directly (KRON indexer + `wss://node.kron.technology`) and decodes each token's
`state_layout` from its covenant scripts — the web server is only a visual
translator.

- **Swap & Pools**: KCC-20 bonding curves + AMM pools, quotes assembled via `@kronsdk/kron-sdk` and signed in-wallet (KIP-12 `signPskt`). No backend counterparty.
- **L1 State**: pools, live tape, and DAA freshness polled straight from the KRON indexer.
- **Wallet**: KasWare (`window.kasware`) for KAS + KCC-20 balances and covenant spend signing.
- **Covenant HTLC**: atomic KAS ↔ token swaps via KirePay/HTLC covenant (legacy module).
- **Analytics / Govern / Lend / Vaults / GameFi / Launchpad**: module shells in the uniframe deck.

Built with React + Vite + Tailwind CSS v4 + `@kronsdk/kron-sdk` + FastAPI (covenant relay).