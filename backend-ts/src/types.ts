export interface TranscriptEvent {
  id: number;
  session_id: string;
  event_type: TranscriptEventType;
  event_id: string;
  parent_event_id: string | null;
  timestamp: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}

export type TranscriptEventType =
  | "user_message"
  | "assistant_message"
  | "tool_start"
  | "tool_complete"
  | "agent_start"
  | "agent_stop"
  | "error"
  | "cancel";

export interface TranscriptEventInput {
  session_id: string;
  event_type: TranscriptEventType;
  event_id?: string;
  parent_event_id?: string | null;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}
