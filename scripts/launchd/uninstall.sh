#!/bin/bash
# Uninstall launchd agents
set -e

LAUNCH_DIR="$HOME/Library/LaunchAgents"

for name in com.roddy.ccm-aggregator com.roddy.ccm-agent; do
  plist="$LAUNCH_DIR/$name.plist"
  if [ -f "$plist" ]; then
    echo "Unloading $name..."
    launchctl unload "$plist" 2>/dev/null || true
    rm "$plist"
    echo "Removed $plist"
  fi
done

echo ""
echo "Uninstalled. Note: ~/.claude-monitor/aggregator-tokens.json is preserved."
