#!/bin/bash
# Setup script for remote machines
# Usage: bash scripts/setup-remote.sh "Machine Name"

set -e

MACHINE_NAME="${1:-$(hostname)}"
CCM_PATH="$HOME/claude-code-monitor-multi/dist/bin/ccm.js"
SETTINGS="$HOME/.claude/settings.json"

# Check if ccm is built
if [ ! -f "$CCM_PATH" ]; then
  echo "Error: ccm not built. Run 'npm install && npm run build' first."
  exit 1
fi

# Check if settings.json exists
if [ ! -f "$SETTINGS" ]; then
  echo "Error: $SETTINGS not found. Is Claude Code installed?"
  exit 1
fi

# Backup settings
cp "$SETTINGS" "$SETTINGS.bak"
echo "Backed up settings to $SETTINGS.bak"

# Add hooks using node (safer than sed for JSON)
node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));
const cmd = (event) => 'node $CCM_PATH hook ' + event;

const hookEntry = (event) => ({
  matcher: '*',
  hooks: [{ type: 'command', command: cmd(event) }]
});

if (!settings.hooks) settings.hooks = {};

const events = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'];
for (const event of events) {
  const existing = settings.hooks[event] || [];
  // Check if ccm hook already exists
  const alreadyHas = existing.some(e =>
    e.hooks?.some(h => h.command?.includes('ccm.js hook'))
  );
  if (!alreadyHas) {
    if (existing.length === 0) {
      settings.hooks[event] = [hookEntry(event)];
    } else {
      // Append ccm hook to existing hooks array
      existing[0].hooks.push({ type: 'command', command: cmd(event) });
    }
  }
}

fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
console.log('Hooks configured successfully!');
"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Now start the agent:"
echo ""
echo "IMPORTANT: If using Tailscale, replace hostname.local with Tailscale IP"
echo "  Example: http://100.110.135.233:3460"
echo ""
echo "  node ~/claude-code-monitor-multi/dist/bin/ccm.js agent \\"
echo "    --server http://YOUR_AGGREGATOR_IP:3460 \\"
echo "    --token YOUR_TOKEN_HERE \\"
echo "    --name \"$MACHINE_NAME\""
echo ""
echo "See docs/TAILSCALE_SETUP.md for detailed configuration guide"
echo ""
