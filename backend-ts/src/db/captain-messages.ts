import { getDb } from "./connection.js";

export interface CaptainMessage {
  id: number;
  conversation_id: string;
  role: "user" | "assistant" | "error";
  content: string;
  source: string;
  source_id: string;
  message_index: number;
  created_at: string;
}

export interface SaveCaptainMessageParams {
  conversationId: string;
  role: "user" | "assistant" | "error";
  content: string;
  source?: string;
  sourceId?: string;
  messageIndex?: number;
}

/**
 * Save a Captain message to the database.
 * Returns the inserted row.
 */
export function saveCaptainMessage(params: SaveCaptainMessageParams): CaptainMessage {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO captain_messages (conversation_id, role, content, source, source_id, message_index)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    params.conversationId,
    params.role,
    params.content,
    params.source ?? "web",
    params.sourceId ?? "",
    params.messageIndex ?? 0
  );
  const row = db
    .prepare("SELECT * FROM captain_messages WHERE id = ?")
    .get(info.lastInsertRowid) as CaptainMessage;
  return row;
}

/**
 * Get Captain messages for a given conversation ID.
 * If no conversationId provided, uses the latest conversation.
 * Returns messages in chronological order (oldest first).
 */
export function getCaptainMessages(conversationId?: string, limit: number = 100): CaptainMessage[] {
  const db = getDb();
  const convId = conversationId ?? getLatestCaptainConversationId();

  if (!convId) {
    return [];
  }

  const rows = db
    .prepare(
      `
    SELECT * FROM captain_messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `
    )
    .all(convId, limit) as CaptainMessage[];

  return rows;
}

/**
 * Get the conversation ID of the most recent Captain message.
 * Returns null if no messages exist.
 */
export function getLatestCaptainConversationId(): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT conversation_id FROM captain_messages
    ORDER BY created_at DESC
    LIMIT 1
  `
    )
    .get() as { conversation_id: string } | undefined;

  return row?.conversation_id ?? null;
}

/**
 * Archive a Captain conversation.
 * Currently a no-op placeholder for future use (e.g., marking as archived).
 * New conversations are created by using a new conversation_id on /clear.
 */
export function archiveCaptainConversation(conversationId: string): void {
  // No-op for now - conversation archival happens by starting a new conversation_id
  // Keep this function for future enhancement (e.g., adding an 'archived' column)
}

/**
 * Get a list of all Captain conversations with metadata.
 * Returns conversations in reverse chronological order (newest first).
 */
export function getCaptainConversationList(
  limit: number = 50
): Array<{
  conversation_id: string;
  message_count: number;
  started_at: string;
  ended_at: string;
}> {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT
      conversation_id,
      COUNT(*) as message_count,
      MIN(created_at) as started_at,
      MAX(created_at) as ended_at
    FROM captain_messages
    GROUP BY conversation_id
    ORDER BY MAX(created_at) DESC
    LIMIT ?
  `
    )
    .all(limit) as Array<{
    conversation_id: string;
    message_count: number;
    started_at: string;
    ended_at: string;
  }>;

  return rows;
}
