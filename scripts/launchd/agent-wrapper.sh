#!/bin/bash
# Wrapper for launching the local agent with persisted token
set -e

TOKENS_FILE="$HOME/.claude-monitor/aggregator-tokens.json"
CCM="$HOME/claude-code-monitor-multi/dist/bin/ccm.js"

# Wait for tokens file (aggregator creates it on first run)
for i in {1..30}; do
  [ -f "$TOKENS_FILE" ] && break
  sleep 1
done

if [ ! -f "$TOKENS_FILE" ]; then
  echo "Error: tokens file not found after 30s: $TOKENS_FILE" >&2
  exit 1
fi

AGENT_TOKEN=$(node -e "console.log(require('$TOKENS_FILE').agentToken)")
MACHINE_NAME="${CCM_MACHINE_NAME:-$(hostname)}"

exec node "$CCM" agent \
  --server http://127.0.0.1:3460 \
  --token "$AGENT_TOKEN" \
  --name "$MACHINE_NAME"
