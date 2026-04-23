import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type WebSocket, WebSocketServer } from 'ws';
import type { AgentUpdate, AggregatorStore, Session } from '../types/index.js';
import { loadOrCreateTokens, resetTokens } from './token-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STALE_MACHINE_MS = 5 * 60 * 1000; // 5 minutes without heartbeat = stale

/**
 * In-memory aggregator store.
 * Merges session data from multiple remote agents.
 */
let store: AggregatorStore = {
  machines: {},
  updated_at: new Date().toISOString(),
};

export function getAggregatorStore(): AggregatorStore {
  return store;
}

export function resetAggregatorStore(): void {
  store = { machines: {}, updated_at: new Date().toISOString() };
}

/**
 * Process an update from a remote agent.
 * Merges sessions into the aggregator store, stamping each with machine_id.
 */
export function processAgentUpdate(update: AgentUpdate): void {
  const now = new Date().toISOString();
  const sessions = update.sessions.map((s) => ({
    ...s,
    machine_id: update.machine_id,
  }));

  store.machines[update.machine_id] = {
    machine_name: update.machine_name,
    sessions,
    last_seen: now,
  };
  store.updated_at = now;
}

/**
 * Remove machines that haven't sent an update recently.
 */
export function pruneStale(): void {
  const now = Date.now();
  let changed = false;
  for (const [id, machine] of Object.entries(store.machines)) {
    if (now - new Date(machine.last_seen).getTime() > STALE_MACHINE_MS) {
      delete store.machines[id];
      changed = true;
    }
  }
  if (changed) {
    store.updated_at = new Date().toISOString();
  }
}

/**
 * Get all sessions across all machines, flattened and sorted.
 */
export function getAllSessions(): Session[] {
  const all: Session[] = [];
  for (const machine of Object.values(store.machines)) {
    all.push(...machine.sessions);
  }
  return all.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * Get sessions grouped by machine.
 */
export function getSessionsByMachine(): Record<string, { machine_name?: string; sessions: Session[] }> {
  const result: Record<string, { machine_name?: string; sessions: Session[] }> = {};
  for (const [id, machine] of Object.entries(store.machines)) {
    result[id] = {
      machine_name: machine.machine_name,
      sessions: machine.sessions,
    };
  }
  return result;
}

// --- WebSocket message types ---

interface AgentWsMessage {
  type: 'agent_update';
  data: AgentUpdate;
}

interface DashboardBroadcast {
  type: 'aggregator_sessions';
  data: {
    machines: Record<string, { machine_name?: string; sessions: Session[] }>;
    total_sessions: number;
  };
}

function broadcastToDashboards(wss: WebSocketServer, dashboardClients: Set<WebSocket>): void {
  pruneStale();
  const message: DashboardBroadcast = {
    type: 'aggregator_sessions',
    data: {
      machines: getSessionsByMachine(),
      total_sessions: getAllSessions().length,
    },
  };
  const data = JSON.stringify(message);
  for (const client of dashboardClients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

function getContentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.js')) return 'application/javascript';
  return 'text/plain';
}

function serveStatic(req: IncomingMessage, res: ServerResponse, validToken: string): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const requestToken = url.searchParams.get('token');
  const filePath = url.pathname === '/' ? '/aggregator.html' : url.pathname;

  const isPublicLibrary = filePath.startsWith('/lib/') && filePath.endsWith('.js');

  if (!isPublicLibrary && requestToken !== validToken) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
    return;
  }

  const publicDir = resolve(__dirname, '../../public');
  const safePath = normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '');
  const fullPath = resolve(publicDir, safePath);

  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

export interface AggregatorOptions {
  port?: number;
  host?: string;
  /** Override agent token (disables persistence) */
  agentToken?: string;
  /** Override dashboard token (disables persistence) */
  dashboardToken?: string;
  /** Force regenerate tokens even if a persisted pair exists */
  resetTokens?: boolean;
}

export interface AggregatorServerInfo {
  url: string;
  port: number;
  host: string;
  dashboardToken: string;
  agentToken: string;
  stop: () => void;
}

/**
 * Start the aggregator server.
 * - Agents connect via WebSocket with ?role=agent&token=<agentToken>
 * - Dashboard clients connect via ?role=dashboard&token=<dashboardToken>
 */
export async function startAggregator(options: AggregatorOptions = {}): Promise<AggregatorServerInfo> {
  const port = options.port ?? 3460;
  const host = options.host ?? '0.0.0.0';

  // Token strategy:
  // - If either override is provided, use them (no persistence)
  // - Else if resetTokens, regenerate + persist
  // - Else load from disk, or generate + persist if none exist
  let agentToken: string;
  let dashboardToken: string;
  if (options.agentToken || options.dashboardToken) {
    const persisted = loadOrCreateTokens();
    agentToken = options.agentToken ?? persisted.agentToken;
    dashboardToken = options.dashboardToken ?? persisted.dashboardToken;
  } else if (options.resetTokens) {
    const fresh = resetTokens();
    agentToken = fresh.agentToken;
    dashboardToken = fresh.dashboardToken;
  } else {
    const tokens = loadOrCreateTokens();
    agentToken = tokens.agentToken;
    dashboardToken = tokens.dashboardToken;
  }

  const dashboardClients = new Set<WebSocket>();

  const server = createServer((req, res) => serveStatic(req, res, dashboardToken));
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '/', `ws://${req.headers.host}`);
    const role = url.searchParams.get('role');
    const token = url.searchParams.get('token');

    if (role === 'agent' && token === agentToken) {
      // Agent connection
      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as AgentWsMessage;
          if (msg.type === 'agent_update' && msg.data) {
            processAgentUpdate(msg.data);
            broadcastToDashboards(wss, dashboardClients);
          }
        } catch {
          // Ignore invalid messages
        }
      });
      ws.on('close', () => {
        // Agent disconnected - sessions will be pruned by staleness timer
      });
      ws.on('error', (err) => {
        console.error('Agent WebSocket error:', err.message);
      });
    } else if (role === 'dashboard' && token === dashboardToken) {
      // Dashboard connection
      dashboardClients.add(ws);
      // Send current state immediately
      pruneStale();
      const initial: DashboardBroadcast = {
        type: 'aggregator_sessions',
        data: {
          machines: getSessionsByMachine(),
          total_sessions: getAllSessions().length,
        },
      };
      ws.send(JSON.stringify(initial));

      ws.on('close', () => {
        dashboardClients.delete(ws);
      });
      ws.on('error', (err) => {
        console.error('Dashboard WebSocket error:', err.message);
        dashboardClients.delete(ws);
      });
    } else {
      ws.close(1008, 'Unauthorized or missing role');
    }
  });

  // Periodic stale pruning + broadcast
  const pruneInterval = setInterval(() => {
    pruneStale();
    broadcastToDashboards(wss, dashboardClients);
  }, 30_000);

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  const actualPort = (server.address() as { port: number }).port;
  const localHostname = hostname();
  const displayHost = host === '0.0.0.0' ? localHostname : host;
  const url = `http://${displayHost}:${actualPort}?token=${dashboardToken}`;

  console.log('\n  Claude Code Monitor - Multi-Machine Aggregator\n');
  console.log(`  Dashboard: ${url}`);
  console.log(`  Agent token: ${agentToken}`);
  console.log(`  Agents connect to: ws://${displayHost}:${actualPort}?role=agent&token=${agentToken}`);
  console.log('\n  Press Ctrl+C to stop.\n');

  return {
    url,
    port: actualPort,
    host,
    dashboardToken,
    agentToken,
    stop: () => {
      clearInterval(pruneInterval);
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      server.close();
    },
  };
}
