import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_HOME = join(tmpdir(), `ccm-token-test-${process.pid}`);

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    homedir: () => TEST_HOME,
  };
});

describe('token-store', () => {
  beforeEach(() => {
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  it('should generate and persist new tokens on first call', async () => {
    const { loadOrCreateTokens, getTokenFilePath } = await import('../src/aggregator/token-store.js');
    const tokens = loadOrCreateTokens();

    expect(tokens.agentToken).toBeDefined();
    expect(tokens.agentToken).toHaveLength(64); // 32 bytes hex
    expect(tokens.dashboardToken).toBeDefined();
    expect(tokens.dashboardToken).toHaveLength(64);
    expect(tokens.agentToken).not.toBe(tokens.dashboardToken);

    expect(existsSync(getTokenFilePath())).toBe(true);
  });

  it('should return the same tokens on subsequent calls', async () => {
    const { loadOrCreateTokens } = await import('../src/aggregator/token-store.js');
    const first = loadOrCreateTokens();
    const second = loadOrCreateTokens();

    expect(second.agentToken).toBe(first.agentToken);
    expect(second.dashboardToken).toBe(first.dashboardToken);
  });

  it('should regenerate tokens when resetTokens is called', async () => {
    const { loadOrCreateTokens, resetTokens } = await import('../src/aggregator/token-store.js');
    const first = loadOrCreateTokens();
    const reset = resetTokens();
    const second = loadOrCreateTokens();

    expect(reset.agentToken).not.toBe(first.agentToken);
    expect(reset.dashboardToken).not.toBe(first.dashboardToken);
    expect(second.agentToken).toBe(reset.agentToken);
    expect(second.dashboardToken).toBe(reset.dashboardToken);
  });

  it('should persist tokens with 0600 permissions', async () => {
    const { loadOrCreateTokens, getTokenFilePath } = await import('../src/aggregator/token-store.js');
    loadOrCreateTokens();

    const { statSync } = await import('node:fs');
    const stat = statSync(getTokenFilePath());
    // Mode bits for permissions (lower 9 bits)
    const perms = stat.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it('should regenerate tokens if file is corrupt', async () => {
    const { loadOrCreateTokens, getTokenFilePath } = await import('../src/aggregator/token-store.js');

    // Write corrupt file
    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, '.claude-monitor'), { recursive: true });
    writeFileSync(getTokenFilePath(), 'not valid json');

    const tokens = loadOrCreateTokens();
    expect(tokens.agentToken).toHaveLength(64);
    expect(tokens.dashboardToken).toHaveLength(64);

    // File should now be valid
    const content = readFileSync(getTokenFilePath(), 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('should regenerate tokens if file is missing required fields', async () => {
    const { loadOrCreateTokens, getTokenFilePath } = await import('../src/aggregator/token-store.js');

    mkdirSync(TEST_HOME, { recursive: true });
    mkdirSync(join(TEST_HOME, '.claude-monitor'), { recursive: true });
    writeFileSync(getTokenFilePath(), JSON.stringify({ agentToken: 'only-agent' }));

    const tokens = loadOrCreateTokens();
    expect(tokens.agentToken).toHaveLength(64);
    expect(tokens.dashboardToken).toHaveLength(64);
    expect(tokens.agentToken).not.toBe('only-agent');
  });
});
