import { hostname } from 'node:os';
import chokidar from 'chokidar';
import WebSocket from 'ws';
import { getSessions, getStorePath } from '../store/file-store.js';
import type { AgentUpdate } from '../types/index.js';

const RECONNECT_DELAY_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface AgentClientOptions {
  serverUrl: string;
  agentToken: string;
  machineName?: string;
  machineId?: string;
}

/**
 * Agent client that watches local sessions.json and pushes updates
 * to the aggregator server via WebSocket.
 */
export function startAgentClient(options: AgentClientOptions): { stop: () => void } {
  const machineId = options.machineId ?? hostname();
  const machineName = options.machineName ?? hostname();
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function sendUpdate(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const sessions = getSessions();
    const update: AgentUpdate = {
      machine_id: machineId,
      machine_name: machineName,
      sessions,
    };

    ws.send(JSON.stringify({ type: 'agent_update', data: update }));
  }

  function connect(): void {
    if (stopped) return;

    // Parse the server URL and add agent params
    const wsUrl = options.serverUrl
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:');
    const url = new URL(wsUrl);
    url.searchParams.set('role', 'agent');
    url.searchParams.set('token', options.agentToken);

    ws = new WebSocket(url.toString());

    ws.on('open', () => {
      console.log(`  Connected to aggregator as "${machineName}" (${machineId})`);
      sendUpdate();

      // Heartbeat: send updates periodically even if no local changes
      heartbeatTimer = setInterval(sendUpdate, HEARTBEAT_INTERVAL_MS);
    });

    ws.on('close', () => {
      console.log('  Disconnected from aggregator. Reconnecting...');
      cleanup();
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('  Agent WebSocket error:', err.message);
      cleanup();
      scheduleReconnect();
    });
  }

  function cleanup(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  // Watch local sessions.json for changes
  const storePath = getStorePath();
  const watcher = chokidar.watch(storePath, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  watcher.on('change', sendUpdate);

  // Initial connection
  connect();

  console.log(`\n  Claude Code Monitor - Agent Mode`);
  console.log(`  Machine: ${machineName} (${machineId})`);
  console.log(`  Server: ${options.serverUrl}`);
  console.log(`  Watching: ${storePath}`);
  console.log('\n  Press Ctrl+C to stop.\n');

  return {
    stop: () => {
      stopped = true;
      cleanup();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      void watcher.close();
      if (ws) {
        ws.close();
      }
    },
  };
}
