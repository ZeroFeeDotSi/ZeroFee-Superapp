#!/bin/bash
# Kept for its old name: the relay's deploy is apps/quotes/deploy.sh now (every key by name, alerts, the live checks).
exec bash "$(dirname "$0")/deploy.sh" "$@"
