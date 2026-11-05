#!/bin/bash
# The test flight recorder's reader (product decision, 4 Nov): the steps the test build took, within about a second.
#   bash tools/trace.sh init       once: the reader's key ($ZEROFEE_HOME/trace-key, mode 600, never printed), the relay's
#                                  read token and build.env (VITE_TEST_TRACE=1, its public key and a fresh trace id)
#   bash tools/trace.sh tail       every second, one line per event: 04:31:02.120 phone tap "Fund $5"
#   bash tools/trace.sh last 200   the last 200 events
# The relay is apps/ios/relay-url.txt (TRACE_RELAY overrides it). The work is tools/trace.ts.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$here/trace.ts" "$@"
