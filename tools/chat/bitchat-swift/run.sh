#!/usr/bin/env bash
# run.sh - build and run the BitChat harness (see Sources/harness/main.swift).
#
#   bash tools/chat/bitchat-swift/run.sh vectors [out.json]
#        writes packages/core/src/bitchat-dm-vectors.json by default
#   bash tools/chat/bitchat-swift/run.sh open <file.json>
#        BitChat's reading of each envelope, as JSON on stdout
#
# Fetches the pinned BitChat sources first if they are not there yet
# (fetch.sh; set BITCHAT_SRC to reuse an existing clone). Build output goes to
# stderr so stdout stays clean JSON.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

[ -f "$HERE/Sources/harness/BitChat/Manifest.swift" ] || bash "$HERE/fetch.sh" ${BITCHAT_SRC:+"$BITCHAT_SRC"}

swift build --package-path "$HERE" -c release --product harness >&2
BIN="$(swift build --package-path "$HERE" -c release --show-bin-path)/harness"

mode="${1:-}"
if [ "$mode" = "vectors" ] && [ $# -lt 2 ]; then
  exec "$BIN" vectors "$REPO/packages/core/src/bitchat-dm-vectors.json"
fi
exec "$BIN" "$@"
