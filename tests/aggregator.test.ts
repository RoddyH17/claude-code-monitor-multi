import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAllSessions,
  getAggregatorStore,
  getSessionsByMachine,
  processAgentUpdate,
  pruneStale,
  resetAggregatorStore,
} from '../src/aggregator/server.js';
import type { AgentUpdate, Session } from '../src/types/index.js';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    session_id: 'sess-1',
    cwd: '/Users/test/project',
    tty: '/dev/ttys001',
    status: 'running',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('aggregator server', () => {
  beforeEach(() => {
    resetAggregatorStore();
  });

  afterEach(() => {
    resetAggregatorStore();
  });

  describe('processAgentUpdate', () => {
    it('should store sessions from a single machine', () => {
      const update: AgentUpdate = {
        machine_id: 'mac-1',
        machine_name: 'MacBook Pro',
        sessions: [
          makeSession({ session_id: 'sess-1', cwd: '/project-a' }),
          makeSession({ session_id: 'sess-2', cwd: '/project-b', status: 'waiting_input' }),
        ],
      };

      processAgentUpdate(update);

      const store = getAggregatorStore();
      expect(Object.keys(store.machines)).toHaveLength(1);
      expect(store.machines['mac-1']).toBeDefined();
      expect(store.machines['mac-1'].sessions).toHaveLength(2);
      expect(store.machines['mac-1'].machine_name).toBe('MacBook Pro');
    });

    it('should store sessions from multiple machines', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        machine_name: 'MacBook Pro',
        sessions: [makeSession({ session_id: 'sess-1' })],
      });

      processAgentUpdate({
        machine_id: 'mac-2',
        machine_name: 'Mac Mini',
        sessions: [
          makeSession({ session_id: 'sess-2' }),
          makeSession({ session_id: 'sess-3' }),
        ],
      });

      const store = getAggregatorStore();
      expect(Object.keys(store.machines)).toHaveLength(2);
      expect(store.machines['mac-1'].sessions).toHaveLength(1);
      expect(store.machines['mac-2'].sessions).toHaveLength(2);
    });

    it('should replace sessions on subsequent updates from the same machine', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [
          makeSession({ session_id: 'sess-1' }),
          makeSession({ session_id: 'sess-2' }),
        ],
      });

      expect(getAggregatorStore().machines['mac-1'].sessions).toHaveLength(2);

      // Machine now only has 1 session (one finished)
      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [makeSession({ session_id: 'sess-1' })],
      });

      expect(getAggregatorStore().machines['mac-1'].sessions).toHaveLength(1);
    });

    it('should stamp sessions with machine_id', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [makeSession({ session_id: 'sess-1' })],
      });

      const sessions = getAggregatorStore().machines['mac-1'].sessions;
      expect(sessions[0].machine_id).toBe('mac-1');
    });

    it('should update last_seen timestamp', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [],
      });

      const firstSeen = getAggregatorStore().machines['mac-1'].last_seen;
      expect(firstSeen).toBeDefined();
    });
  });

  describe('getAllSessions', () => {
    it('should return empty array when no machines', () => {
      expect(getAllSessions()).toEqual([]);
    });

    it('should return all sessions across machines, sorted by created_at', () => {
      const earlier = new Date(Date.now() - 10000).toISOString();
      const later = new Date().toISOString();

      processAgentUpdate({
        machine_id: 'mac-2',
        sessions: [makeSession({ session_id: 'sess-later', created_at: later })],
      });

      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [makeSession({ session_id: 'sess-earlier', created_at: earlier })],
      });

      const all = getAllSessions();
      expect(all).toHaveLength(2);
      expect(all[0].session_id).toBe('sess-earlier');
      expect(all[1].session_id).toBe('sess-later');
    });
  });

  describe('getSessionsByMachine', () => {
    it('should return sessions grouped by machine', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        machine_name: 'MacBook Pro',
        sessions: [makeSession({ session_id: 'sess-1' })],
      });

      processAgentUpdate({
        machine_id: 'mac-2',
        machine_name: 'Mac Mini',
        sessions: [makeSession({ session_id: 'sess-2' })],
      });

      const grouped = getSessionsByMachine();
      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['mac-1'].machine_name).toBe('MacBook Pro');
      expect(grouped['mac-1'].sessions).toHaveLength(1);
      expect(grouped['mac-2'].machine_name).toBe('Mac Mini');
      expect(grouped['mac-2'].sessions).toHaveLength(1);
    });
  });

  describe('pruneStale', () => {
    it('should not prune recently active machines', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [makeSession()],
      });

      pruneStale();

      expect(Object.keys(getAggregatorStore().machines)).toHaveLength(1);
    });

    it('should prune machines that havent sent updates in 5+ minutes', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [makeSession()],
      });

      // Manually backdate the last_seen
      const store = getAggregatorStore();
      store.machines['mac-1'].last_seen = new Date(Date.now() - 6 * 60 * 1000).toISOString();

      pruneStale();

      expect(Object.keys(getAggregatorStore().machines)).toHaveLength(0);
    });

    it('should only prune stale machines, keep active ones', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [makeSession()],
      });

      processAgentUpdate({
        machine_id: 'mac-2',
        sessions: [makeSession()],
      });

      // Only backdate mac-1
      const store = getAggregatorStore();
      store.machines['mac-1'].last_seen = new Date(Date.now() - 6 * 60 * 1000).toISOString();

      pruneStale();

      expect(Object.keys(getAggregatorStore().machines)).toHaveLength(1);
      expect(getAggregatorStore().machines['mac-2']).toBeDefined();
    });
  });

  describe('resetAggregatorStore', () => {
    it('should clear all data', () => {
      processAgentUpdate({
        machine_id: 'mac-1',
        sessions: [makeSession(), makeSession({ session_id: 'sess-2' })],
      });

      expect(Object.keys(getAggregatorStore().machines)).toHaveLength(1);

      resetAggregatorStore();

      expect(Object.keys(getAggregatorStore().machines)).toHaveLength(0);
      expect(getAllSessions()).toHaveLength(0);
    });
  });
});
