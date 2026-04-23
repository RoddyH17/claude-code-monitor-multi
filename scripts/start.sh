#!/bin/bash
# Start aggregator + local agent for claude-code-monitor-multi
# Usage: ./scripts/start.sh

set -e

CCM_DIR="$HOME/claude-code-monitor-multi"
CCM="$CCM_DIR/dist/bin/ccm.js"
TOKENS_FILE="$HOME/.claude-monitor/aggregator-tokens.json"
LOG_DIR="$HOME/.claude-monitor/logs"

mkdir -p "$LOG_DIR"

# Kill any existing aggregator/agent processes
pkill -f "ccm.js aggregator" 2>/dev/null || true
pkill -f "ccm.js agent" 2>/dev/null || true
sleep 1

# Start aggregator
echo "Starting aggregator..."
nohup node "$CCM" aggregator > "$LOG_DIR/aggregator.log" 2>&1 &
sleep 2

# Read persisted tokens
if [ ! -f "$TOKENS_FILE" ]; then
  echo "Error: tokens file not found at $TOKENS_FILE"
  exit 1
fi

AGENT_TOKEN=$(node -e "console.log(require('$TOKENS_FILE').agentToken)")
DASHBOARD_TOKEN=$(node -e "console.log(require('$TOKENS_FILE').dashboardToken)")

# Start local agent
echo "Starting local agent..."
nohup node "$CCM" agent \
  --server http://127.0.0.1:3460 \
  --token "$AGENT_TOKEN" \
  --name "MacBook Air (Main)" > "$LOG_DIR/agent.log" 2>&1 &
sleep 1

echo ""
echo "=== Started ==="
echo "Dashboard: http://127.0.0.1:3460?token=$DASHBOARD_TOKEN"
echo "Agent token (for other machines): $AGENT_TOKEN"
echo ""
echo "Logs: $LOG_DIR/"
echo "Stop: pkill -f 'ccm.js (aggregator|agent)'"
