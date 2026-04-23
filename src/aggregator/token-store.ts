import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TOKEN_DIR = join(homedir(), '.claude-monitor');
const TOKEN_FILE = join(TOKEN_DIR, 'aggregator-tokens.json');

export interface AggregatorTokens {
  agentToken: string;
  dashboardToken: string;
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function ensureTokenDir(): void {
  if (!existsSync(TOKEN_DIR)) {
    mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load persisted tokens, or generate + save new ones if none exist.
 * Tokens live at ~/.claude-monitor/aggregator-tokens.json
 */
export function loadOrCreateTokens(): AggregatorTokens {
  ensureTokenDir();

  if (existsSync(TOKEN_FILE)) {
    try {
      const content = readFileSync(TOKEN_FILE, 'utf-8');
      const parsed = JSON.parse(content) as Partial<AggregatorTokens>;
      if (parsed.agentToken && parsed.dashboardToken) {
        return {
          agentToken: parsed.agentToken,
          dashboardToken: parsed.dashboardToken,
        };
      }
    } catch {
      // Corrupt file — fall through and regenerate
    }
  }

  const tokens: AggregatorTokens = {
    agentToken: generateToken(),
    dashboardToken: generateToken(),
  };
  saveTokens(tokens);
  return tokens;
}

/**
 * Force regenerate both tokens. Used by `ccm aggregator --reset-tokens`.
 */
export function resetTokens(): AggregatorTokens {
  const tokens: AggregatorTokens = {
    agentToken: generateToken(),
    dashboardToken: generateToken(),
  };
  saveTokens(tokens);
  return tokens;
}

export function saveTokens(tokens: AggregatorTokens): void {
  ensureTokenDir();
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function getTokenFilePath(): string {
  return TOKEN_FILE;
}
