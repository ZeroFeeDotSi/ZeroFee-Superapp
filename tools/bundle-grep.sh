#!/bin/bash
# Greps a built web bundle for code that only a developer or test build may hold (the audit's finding, 7 Nov: build flags read
# in a form Vite may not fold ship their switched-off code in every bundle). Exits 1 if any marker is in the bundle.
#   bash tools/bundle-grep.sh <outdir>          e.g. the folder `vite build --outDir` wrote (apps/web)
# Each marker is a string from the code behind one dev-only flag, and it must still be in that source file, or the check
# can't fire: then this script stops with 2 (update the marker).
#   VITE_ZF_TEST_LANE=1        rulebox.ts testLaneHeader: the test machines' sign-up token (its header, its storage key)
#   VITE_AGENTZERO_OWN_KEY=1   AgentApp.tsx's own-key row (OWN_KEY_ON), and turn.ts's own-claude.ts (the person's own
#                              Claude key, straight to Anthropic): its chunk is named after the file
set -uo pipefail
out="${1:-}"
[ -n "$out" ] && [ -d "$out" ] || { echo "usage: bash tools/bundle-grep.sh <built folder>" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
# marker|source file it comes from (relative to the repo)|the flag that builds it in
MARKERS=(
  'x-zf-test-token|packages/agent/src/zero/rulebox.ts|VITE_ZF_TEST_LANE'
  'zf.test.token|packages/agent/src/zero/rulebox.ts|VITE_ZF_TEST_LANE'
  'Claude Opus 5.5: add your key|packages/agent/src/app/AgentApp.tsx|VITE_AGENTZERO_OWN_KEY'
  'Claude Opus 5.5: your own key|packages/agent/src/app/AgentApp.tsx|VITE_AGENTZERO_OWN_KEY'
)
# a module that must not be a chunk of its own: file name|its source
FILES=(
  'own-claude|packages/agent/src/chat/own-claude.ts|VITE_AGENTZERO_OWN_KEY'
)
found=0
for m in "${FILES[@]}"; do
  IFS='|' read -r name src flag <<< "$m"
  [ -f "$repo/$src" ] || { echo "STOP: $src is gone, so the check for its chunk can't fire: update tools/bundle-grep.sh" >&2; exit 2; }
  hits="$(find "$out" -type f -name "*$name*" | sed "s#^$out/##" | tr '\n' ' ')"
  if [ -n "$hits" ]; then echo "FOUND the chunk of $src ($flag): $hits"; found=1; fi
done
for m in "${MARKERS[@]}"; do
  IFS='|' read -r text src flag <<< "$m"
  grep -qF -- "$text" "$repo/$src" || { echo "STOP: the marker \"$text\" is gone from $src, so its check can't fire: update tools/bundle-grep.sh" >&2; exit 2; }
  hits="$(grep -rlF -- "$text" "$out" | sed "s#^$out/##" | tr '\n' ' ')"
  if [ -n "$hits" ]; then echo "FOUND \"$text\" ($flag) in: $hits"; found=1; fi
done
[ "$found" = 0 ] && echo "clean: none of ${#MARKERS[@]} dev-only strings and ${#FILES[@]} dev-only chunks in $out"
exit "$found"
