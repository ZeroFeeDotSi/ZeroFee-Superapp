#!/bin/bash
# Self-host ZeroFee in one command, from the repo root:   bash tools/selfhost/run.sh   (or: make selfhost)
# 1. installs the exact dependencies (npm ci, no install scripts) if node_modules is missing;
# 2. builds the web app for this machine: the public build (sample money in the wallet, live market data in Trade)
#    with its relay on the same origin (VITE_ZEROFEE_RELAY=http://$HOST:$PORT);
# 3. serves the page and the relay on one port (tools/selfhost/serve.mjs), reading your keys from .env if you made one.
# Every key in .env.example is optional; with none, Trade's market data uses the free tiers of its data sources.
set -euo pipefail
cd "$(dirname "$0")/../.."
envval() { [ -f .env ] && sed -n "s/^$1=\(.*\)$/\1/p" .env | tail -1 | tr -d "\"'" || true; }
PORT="${PORT:-$(envval PORT)}"; PORT="${PORT:-5180}"
HOST="${HOST:-$(envval HOST)}"; HOST="${HOST:-localhost}"
node -e 'const [maj]=process.versions.node.split(".").map(Number); if (maj < 24) { console.error(`Node 24 or later is needed (this is ${process.version}). See .nvmrc.`); process.exit(1); }'
[ -d node_modules ] || npm ci --ignore-scripts
echo "Building the web app (about a minute)..."
VITE_ZEROFEE_PUBLIC=1 VITE_HOME_PROOF=1 VITE_WEB_TRADE=1 VITE_ZEROFEE_RELAY="http://$HOST:$PORT" \
  npm run -s -w @zerofee/web build > /dev/null
PORT="$PORT" HOST="$HOST" exec node tools/selfhost/serve.mjs
