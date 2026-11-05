#!/bin/bash
# Fake money on the Solana copy (tools/fork/sol/start.sh must be up): SOL from the copy's faucet, USDC minted by the copy's
# own faucet key (USDC's mint authority on the copy only). Loopback only: it never talks to any other node.
#   bash tools/fork/sol/fund.sh <wallet address> [SOL, default 10] [USDC, default 1000]
set -euo pipefail
BIN="${SOLANA_BIN:-$HOME/.local/share/solana/install/active_release/bin}"
HOME_DIR="${FORK_SOL_HOME:-$HOME/.cache/zerofee-fork/sol}"
RPC=http://127.0.0.1:8899
USDC=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
to="${1:?usage: fund.sh <wallet address> [SOL] [USDC]}"; sol="${2:-10}"; usdc="${3:-1000}"
# every call names the copy and the copy's own key (the CLI's own config may point at mainnet and a real key)
"$BIN/solana" airdrop "$sol" "$to" --url "$RPC" --keypair "$HOME_DIR/faucet.json" >/dev/null
# the wallet's USDC account first (idempotent: an existing one is kept)
"$BIN/spl-token" create-account "$USDC" --owner "$to" --fee-payer "$HOME_DIR/faucet.json" --url "$RPC" >/dev/null 2>&1 || true
"$BIN/spl-token" mint "$USDC" "$usdc" --recipient-owner "$to" --mint-authority "$HOME_DIR/faucet.json" --fee-payer "$HOME_DIR/faucet.json" --url "$RPC" >/dev/null
echo "funded $to: $("$BIN/solana" balance "$to" --url "$RPC" --keypair "$HOME_DIR/faucet.json"), $("$BIN/spl-token" balance "$USDC" --owner "$to" --url "$RPC" --fee-payer "$HOME_DIR/faucet.json") USDC"
