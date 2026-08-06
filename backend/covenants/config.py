"""Network configuration for the covenant swap engine (config-driven).

NETWORKS["testnet-10"] -> default, matches existing DEX tooling, covenants live.
NETWORKS["mainnet"]    -> Toccata live since 2026-06-30 (KIP-17/20).
Override everything with env vars.
"""
import os

SOMPI_PER_KAS = 100_000_000
FEE_SOMPI = 1_000_000
MIN_OUT_SOMPI = 1_000_000
LOCKTIME_MARGIN = 200
DEFAULT_TIMEOUT_DAA = 3_600
DEFAULT_USDT_PER_KAS = 0.15

# testnet-10 public wRPC node (used and proven by the kaspa-covenants reference
# implementation); mainnet uses the official public wRPC gateway.
NETWORKS = {
    "testnet-10": {
        "label": "testnet-10",
        "network_id": "testnet-10",
        "address_net": "testnet-10",
        "rpc_url": os.environ.get(
            "KASPA_TESTNET10_RPC",
            "ws://159.195.64.93:8080/kaspa/testnet-10/wrpc/borsh",
        ),
        "explorer": "https://explorer-tn10.kaspa.org",
        "dex_address": os.environ.get(
            "KASPA_TESTNET10_DEX_ADDRESS",
            "kaspatest:qrlc9t0mncjgm6t5hcdrz7fjzz678tkh3dcekagf2s7wkxssx0gu5rkjj564z",
        ),
        "dex_private_key": os.environ.get(
            "KASPA_TESTNET10_DEX_PRIVATE_KEY",
            "7a74ebcd6e36bc2599e45d69b850d1572747967a8143da0902c94faa93fa32f0",
        ),
    },
    "mainnet": {
        "label": "mainnet",
        "network_id": "mainnet",
        "address_net": "mainnet",
        "rpc_url": os.environ.get("KASPA_MAINNET_RPC", "wss://wrpc.kaspa.org"),
        "explorer": "https://explorer.kaspa.org",
        "dex_address": os.environ.get("KASPA_MAINNET_DEX_ADDRESS", ""),
        "dex_private_key": os.environ.get("KASPA_MAINNET_DEX_PRIVATE_KEY", ""),
    },
}

COVENANT_NETWORK = os.environ.get("KASPA_NETWORK", "testnet-10")
if COVENANT_NETWORK not in NETWORKS:
    raise ValueError(f"KASPA_NETWORK must be one of {list(NETWORKS)}")


def get_network(network: str | None = None) -> dict:
    return NETWORKS[network or COVENANT_NETWORK]


def usdt_per_kas() -> float:
    try:
        return float(os.environ.get("KASPA_USDT_RATE", DEFAULT_USDT_PER_KAS))
    except ValueError:
        return DEFAULT_USDT_PER_KAS
