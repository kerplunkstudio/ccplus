import { getDb } from "./connection.js";

export function getSessionsList(limit: number = 50, projectPath?: string, includeArchived: boolean = false): Record<string, unknown>[] {
  const d = getDb();
  const archivedClause = includeArchived ? "" : "AND (c1.archived = 0 OR c1.archived IS NULL)";
  const projectFilter = projectPath ? "WHERE project_path = ?" : "";
  const params: unknown[] = projectPath ? [projectPath, limit] : [limit];

  const rows = d.prepare(`
    WITH session_data AS (
      SELECT
        session_id,
        COUNT(*) as message_count,
        MAX(timestamp) as last_activity,
        (SELECT content FROM conversations c2
         WHERE c2.session_id = c1.session_id AND c2.role = 'user'
         ORDER BY c2.timestamp ASC LIMIT 1) as last_user_message,
        (SELECT project_path FROM conversations c3
         WHERE c3.session_id = c1.session_id AND c3.role = 'user'
         AND c3.project_path IS NOT NULL
         ORDER BY c3.timestamp DESC LIMIT 1) as project_path
      FROM conversations c1
      WHERE 1=1 ${archivedClause}
      GROUP BY session_id
    )
    SELECT * FROM session_data
    ${projectFilter}
    ORDER BY last_activity DESC
    LIMIT ?
  `).all(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const entry = { ...row };
    if (entry.last_user_message && typeof entry.last_user_message === "string" && (entry.last_user_message as string).length > 80) {
      entry.last_user_message = (entry.last_user_message as string).slice(0, 80) + "...";
    }
    return entry;
  });
}

export function getLastSdkSessionId(sessionId: string): string | null {
  const d = getDb();
  const row = d.prepare(`
    SELECT sdk_session_id FROM conversations
    WHERE session_id = ? AND sdk_session_id IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 1
  `).get(sessionId) as { sdk_session_id: string } | undefined;
  return row?.sdk_session_id ?? null;
}

export function archiveSession(sessionId: string): boolean {
  const d = getDb();
  try {
    d.prepare("UPDATE conversations SET archived = 1 WHERE session_id = ?").run(sessionId);
    d.prepare("DELETE FROM images WHERE session_id = ?").run(sessionId);
    return true;
  } catch {
    return false;
  }
}

export function duplicateSession(sourceSessionId: string, newSessionId: string, userId: string): { conversations: number; toolEvents: number; images: number } {
  const d = getDb();

  // Copy conversations (update session_id to new, keep everything else)
  const convResult = d.prepare(`
    INSERT INTO conversations (session_id, user_id, role, content, timestamp, sdk_session_id, project_path, archived, images)
    SELECT ?, user_id, role, content, timestamp, sdk_session_id, project_path, 0, images
    FROM conversations WHERE session_id = ? ORDER BY id
  `).run(newSessionId, sourceSessionId);

  // Copy tool_usage (update session_id, keep parent relationships intact)
  const toolResult = d.prepare(`
    INSERT INTO tool_usage (timestamp, session_id, tool_name, duration_ms, success, error, error_category, parameters, tool_use_id, parent_agent_id, agent_type, input_tokens, output_tokens, description)
    SELECT timestamp, ?, tool_name, duration_ms, success, error, error_category, parameters, tool_use_id, parent_agent_id, agent_type, input_tokens, output_tokens, description
    FROM tool_usage WHERE session_id = ? ORDER BY id
  `).run(newSessionId, sourceSessionId);

  // Copy images (generate new UUIDs to avoid UNIQUE constraint violations)
  const sourceImages = d.prepare(`SELECT * FROM images WHERE session_id = ?`).all(sourceSessionId) as Array<{
    id: string;
    filename: string;
    mime_type: string;
    size: number;
    data: Buffer;
    uploaded_at: string;
  }>;

  let imagesCopied = 0;
  const insertImage = d.prepare(`
    INSERT INTO images (id, filename, mime_type, size, data, uploaded_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const img of sourceImages) {
    // Generate new UUID for the duplicated image
    const newImageId = `${img.id.split('-')[0]}-dup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    insertImage.run(newImageId, img.filename, img.mime_type, img.size, img.data, img.uploaded_at, newSessionId);
    imagesCopied++;
  }

  const imageResult = { changes: imagesCopied };

  return {
    conversations: convResult.changes,
    toolEvents: toolResult.changes,
    images: imageResult.changes,
  };
}

export function getSessionContext(sessionId: string): { input_tokens: number; model: string | null } | null {
  const d = getDb();
  const row = d.prepare(`SELECT input_tokens, model FROM session_context WHERE session_id = ?`).get(sessionId) as { input_tokens: number; model: string | null } | undefined;
  return row ?? null;
}

export function updateSessionContext(sessionId: string, inputTokens: number, model: string | null): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO session_context (session_id, input_tokens, model, updated_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(session_id) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).run(sessionId, inputTokens, model);
}
