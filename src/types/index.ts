// Hook event types
export type HookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'
  | 'UserPromptSubmit';

// Event received from hooks (for internal processing)
export interface HookEvent {
  session_id: string;
  cwd: string;
  tty?: string;
  hook_event_name: HookEventName;
  notification_type?: string;
  transcript_path?: string;
}

// Session status
export type SessionStatus = 'running' | 'waiting_input' | 'stopped';

// Session information (minimal)
export interface Session {
  session_id: string;
  cwd: string;
  tty?: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  lastMessage?: string;
  /** Machine identifier for multi-machine aggregation */
  machine_id?: string;
}

// File store data structure
export interface StoreData {
  sessions: Record<string, Session>;
  updated_at: string;
}

// Aggregator: data received from a remote agent
export interface AgentUpdate {
  machine_id: string;
  machine_name?: string;
  sessions: Session[];
}

// Aggregator: merged store keyed by machine_id
export interface AggregatorStore {
  machines: Record<string, {
    machine_name?: string;
    sessions: Session[];
    last_seen: string;
  }>;
  updated_at: string;
}
