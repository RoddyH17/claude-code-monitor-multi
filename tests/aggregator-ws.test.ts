import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { resetAggregatorStore, startAggregator, type AggregatorServerInfo } from '../src/aggregator/server.js';

describe('aggregator WebSocket integration', () => {
  let server: AggregatorServerInfo;
  const openSockets: WebSocket[] = [];

  beforeEach(async () => {
    resetAggregatorStore();
    server = await startAggregator({ port: 0, host: '127.0.0.1', agentToken: 'test-agent-token' });
  });

  afterEach(() => {
    for (const ws of openSockets) {
      try { ws.close(); } catch {}
    }
    openSockets.length = 0;
    server?.stop();
    resetAggregatorStore();
  });

  function createWs(role: string, token: string): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}?role=${role}&token=${token}`);
    openSockets.push(ws);
    return ws;
  }

  function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
  }

  function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitForMessage timed out')), timeoutMs);
      ws.once('message', (data: Buffer) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  /** Connect and collect ALL messages into a buffer. Return helpers to wait for N messages. */
  function connectWithBuffer(role: string, token: string) {
    const ws = createWs(role, token);
    const messages: Record<string, unknown>[] = [];
    let resolve: (() => void) | null = null;
    let waitingFor = 0;

    ws.on('message', (data: Buffer) => {
      messages.push(JSON.parse(data.toString()));
      if (resolve && messages.length >= waitingFor) {
        resolve();
        resolve = null;
      }
    });

    return {
      ws,
      messages,
      waitForOpen: () => waitForOpen(ws),
      /** Wait until at least N messages have been collected */
      waitForNMessages: (n: number, timeoutMs = 5000): Promise<void> => {
        if (messages.length >= n) return Promise.resolve();
        waitingFor = n;
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`Timeout waiting for ${n} messages, got ${messages.length}`)), timeoutMs);
          resolve = () => { clearTimeout(timer); res(); };
        });
      },
    };
  }

  it('should reject connections with invalid token', async () => {
    const ws = createWs('agent', 'wrong-token');
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });
    expect(code).toBe(1008);
  });

  it('should accept agent connection and forward to dashboard', async () => {
    // Connect dashboard with message buffer
    const dashboard = connectWithBuffer('dashboard', server.dashboardToken);
    await dashboard.waitForOpen();
    // Wait for initial state
    await dashboard.waitForNMessages(1);
    expect(dashboard.messages[0].type).toBe('aggregator_sessions');

    // Connect agent
    const agent = createWs('agent', server.agentToken);
    await waitForOpen(agent);

    // Agent sends update
    agent.send(JSON.stringify({
      type: 'agent_update',
      data: {
        machine_id: 'test-machine',
        machine_name: 'Test MacBook',
        sessions: [{
          session_id: 'sess-1',
          cwd: '/Users/test/project',
          status: 'running',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      },
    }));

    // Wait for broadcast to dashboard (message #2)
    await dashboard.waitForNMessages(2);
    const msg = dashboard.messages[1];
    expect(msg.type).toBe('aggregator_sessions');
    const data = msg.data as Record<string, unknown>;
    expect(data.total_sessions).toBe(1);
    const machines = data.machines as Record<string, unknown>;
    expect(machines['test-machine']).toBeDefined();
  });

  it('should send initial state to new dashboard connection', async () => {
    // Send an agent update first
    const agent = createWs('agent', server.agentToken);
    await waitForOpen(agent);
    agent.send(JSON.stringify({
      type: 'agent_update',
      data: {
        machine_id: 'mac-1',
        sessions: [{ session_id: 's1', cwd: '/tmp', status: 'running', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      },
    }));

    // Small delay for server to process
    await new Promise((r) => setTimeout(r, 100));

    // Now connect dashboard — should get current state with 1 session
    const dashboard = connectWithBuffer('dashboard', server.dashboardToken);
    await dashboard.waitForOpen();
    await dashboard.waitForNMessages(1);

    const data = dashboard.messages[0].data as Record<string, unknown>;
    expect(data.total_sessions).toBe(1);
  });

  it('should handle multiple machines', async () => {
    const dashboard = connectWithBuffer('dashboard', server.dashboardToken);
    await dashboard.waitForOpen();
    await dashboard.waitForNMessages(1); // initial empty

    const agent1 = createWs('agent', server.agentToken);
    const agent2 = createWs('agent', server.agentToken);
    await Promise.all([waitForOpen(agent1), waitForOpen(agent2)]);

    // Agent 1 sends
    agent1.send(JSON.stringify({
      type: 'agent_update',
      data: {
        machine_id: 'mac-1',
        machine_name: 'MacBook Pro',
        sessions: [{ session_id: 's1', cwd: '/a', status: 'running', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      },
    }));
    await dashboard.waitForNMessages(2);

    // Agent 2 sends
    agent2.send(JSON.stringify({
      type: 'agent_update',
      data: {
        machine_id: 'mac-2',
        machine_name: 'Mac Mini',
        sessions: [
          { session_id: 's2', cwd: '/b', status: 'waiting_input', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { session_id: 's3', cwd: '/c', status: 'stopped', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
      },
    }));
    await dashboard.waitForNMessages(3);

    const lastMsg = dashboard.messages[dashboard.messages.length - 1];
    const data = lastMsg.data as Record<string, unknown>;
    expect(data.total_sessions).toBe(3);
    const machines = data.machines as Record<string, unknown>;
    expect(Object.keys(machines)).toHaveLength(2);
  });
}, 30000);
