#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export ARC_RPC_URL="${ARC_RPC_URL:-https://rpc.mainnet.arc.io}"
export ARC_FORK_BLOCK="${ARC_FORK_BLOCK:-24032582}"
export RUN_ARC_FORK=true
exec .tools/arc/forge test --network arc --match-contract ArcForkTest -vv
