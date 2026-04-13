# Tailscale Setup for Remote Agents

When using Claude Code Monitor across multiple machines connected via Tailscale, you need to configure the agent to use Tailscale IP addresses instead of `.local` mDNS hostnames.

## Problem

mDNS (`.local`) hostname resolution may not work correctly over Tailscale VPN networks:
- ❌ `http://hostname.local:3460` - DNS resolution fails
- ✅ `http://100.x.x.x:3460` - Direct IP works

## Setup Steps

### 1. Find Your Aggregator IP

On your **aggregator machine** (where you run the web dashboard):

```bash
# Method 1: Check all network interfaces
ifconfig | grep "inet " | grep -v 127.0.0.1

# Method 2: Get Tailscale IP specifically
tailscale ip -4
```

Look for the IP in the `100.x.x.x` range (Tailscale network).

Example output:
```
inet 100.110.135.233 netmask 0xffffffc0 broadcast 100.110.135.255
```

### 2. Configure Remote Agent

On your **remote machine** (Mac Mini, etc.):

#### Option A: Use setup-remote.sh script

1. Edit `scripts/setup-remote.sh` and update:
   ```bash
   SERVER_URL="http://100.110.135.233:3460"  # Your aggregator Tailscale IP
   TOKEN="your-token-from-aggregator"
   ```

2. Run:
   ```bash
   bash scripts/setup-remote.sh "Mac Mini"
   ```

#### Option B: Manual command

```bash
node ~/claude-code-monitor-multi/dist/bin/ccm.js agent \
  --server http://100.110.135.233:3460 \
  --token YOUR_TOKEN_HERE \
  --name "Mac Mini"
```

### 3. Fix Hooks Configuration

The hooks in `~/.claude/settings.json` must use the correct home directory path.

**Check your username:**
```bash
whoami && echo $HOME
```

**Update settings.json hooks:**

Replace `/Users/OLD_USERNAME/` with your actual home path in all hook commands:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/YOUR_USERNAME/claude-code-monitor-multi/dist/bin/ccm.js hook UserPromptSubmit"
      }]
    }],
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/YOUR_USERNAME/claude-code-monitor-multi/dist/bin/ccm.js hook PreToolUse"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/YOUR_USERNAME/claude-code-monitor-multi/dist/bin/ccm.js hook PostToolUse"
      }]
    }],
    "Notification": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/YOUR_USERNAME/claude-code-monitor-multi/dist/bin/ccm.js hook Notification"
      }]
    }],
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/YOUR_USERNAME/claude-code-monitor-multi/dist/bin/ccm.js hook Stop"
      }]
    }]
  }
}
```

**Pro tip:** Use absolute paths with `$HOME` won't work in JSON, so use full `/Users/username/` path.

### 4. Verify Connection

Test the connection:

```bash
# Test port connectivity
nc -zv 100.110.135.233 3460

# Test HTTP endpoint
curl http://100.110.135.233:3460
```

Expected: `Connection succeeded` and `Unauthorized` HTTP response.

## Troubleshooting

### Agent can't connect

**Symptom:**
```
Agent WebSocket error: getaddrinfo ENOTFOUND hostname.local
```

**Solution:**
1. Replace `.local` hostname with Tailscale IP
2. Verify both machines are on Tailscale: `tailscale status`
3. Check aggregator is running: `lsof -i :3460`

### "No active session" in dashboard

**Causes:**
1. **Hooks not running** - Check `~/.claude/settings.json` paths
2. **sessions.json doesn't exist** - Send a message in Claude Code to trigger hooks
3. **Wrong directory** - Hooks must point to correct `$HOME` path

**Fix:**
```bash
# Verify hooks are configured
cat ~/.claude/settings.json | grep "claude-code-monitor-multi"

# Check if sessions.json exists
cat ~/.claude-monitor/sessions.json

# Manually trigger (send a message in Claude Code)
# Or restart VSCode/Claude Code extension
```

### Permission denied

Ensure scripts are executable:
```bash
chmod +x ~/claude-code-monitor-multi/scripts/setup-remote.sh
```

## Network Topology

```
┌─────────────────────────────────────────────────────┐
│                  Tailscale Network                  │
│                   (100.x.x.x/10)                    │
│                                                     │
│  ┌─────────────────┐          ┌─────────────────┐  │
│  │  MacBook Air    │          │    Mac Mini     │  │
│  │  (Aggregator)   │◄────────►│    (Agent)      │  │
│  │  100.110.135.233│          │ 100.110.135.245 │  │
│  │  Port: 3460     │          │                 │  │
│  └─────────────────┘          └─────────────────┘  │
│         ▲                                           │
│         │                                           │
│         └──── Mobile browser access                 │
└─────────────────────────────────────────────────────┘
```

## Security Notes

- Token is shared in plaintext in scripts - keep `setup-remote.sh` private
- Don't commit tokens to Git - use environment variables or config files
- Tailscale provides encrypted tunnel - traffic is secure
- Only machines on your Tailscale network can access the aggregator

## Alternative: Tailscale MagicDNS

If you have Tailscale MagicDNS enabled, you can use machine names:

```bash
# Instead of IP:
SERVER_URL="http://macbook-air:3460"

# Check if MagicDNS is enabled:
tailscale status | grep MagicDNS
```
