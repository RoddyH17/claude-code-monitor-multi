// Types
export type {
  AgentUpdate,
  AggregatorStore,
  HookEvent,
  HookEventName,
  Session,
  SessionStatus,
  StoreData,
} from './types/index.js';

// Store functions
export {
  clearSessions,
  getSession,
  getSessions,
  getStorePath,
} from './store/file-store.js';

// Aggregator
export { startAggregator } from './aggregator/server.js';
export { startAgentClient } from './aggregator/agent-client.js';

// Utilities
export { focusSession, getSupportedTerminals, isMacOS } from './utils/focus.js';
export { sendTextToTerminal } from './utils/send-text.js';
export { getStatusDisplay } from './utils/status.js';
