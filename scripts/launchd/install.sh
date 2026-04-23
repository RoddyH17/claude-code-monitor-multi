#!/bin/bash
# Install launchd agents for auto-starting ccm aggregator + agent on login
set -e

LAUNCH_DIR="$HOME/Library/LaunchAgents"
PLIST_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HOME/.claude-monitor/logs"

mkdir -p "$LAUNCH_DIR" "$LOG_DIR"

# Find node binary (launchd has a minimal PATH)
NODE_BIN=$(which node || echo "")
if [ -z "$NODE_BIN" ]; then
  echo "Error: node not found in PATH"
  exit 1
fi
echo "Using node at: $NODE_BIN"

# Make wrapper executable
chmod +x "$PLIST_DIR/agent-wrapper.sh"

install_plist() {
  local name="$1"
  local src="$PLIST_DIR/$name.plist"
  local dst="$LAUNCH_DIR/$name.plist"

  # Unload if already running
  if launchctl list | grep -q "$name"; then
    echo "Unloading existing $name..."
    launchctl unload "$dst" 2>/dev/null || true
  fi

  # Substitute __HOME__ and node path
  sed -e "s|__HOME__|$HOME|g" \
      -e "s|/usr/local/bin/node|$NODE_BIN|g" \
      "$src" > "$dst"

  echo "Loading $name..."
  launchctl load "$dst"
}

install_plist "com.roddy.ccm-aggregator"
sleep 2  # Let aggregator start before agent tries to read tokens
install_plist "com.roddy.ccm-agent"

echo ""
echo "=== Installed ==="
echo ""
echo "Agents:"
launchctl list | grep "com.roddy.ccm" || echo "  (none found yet, may take a moment)"
echo ""
echo "Logs:"
echo "  tail -f $LOG_DIR/aggregator.log"
echo "  tail -f $LOG_DIR/agent.log"
echo ""
echo "Uninstall: bash $PLIST_DIR/uninstall.sh"
