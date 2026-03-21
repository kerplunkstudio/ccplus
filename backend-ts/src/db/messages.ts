import { getDb } from "./connection.js";
import { getMessageImages } from "./images.js";

export function recordMessage(
  sessionId: string,
  userId: string,
  role: string,
  content: string,
  sdkSessionId?: string,
  projectPath?: string,
  imageIds?: string[],
): Record<string, unknown> {
  const d = getDb();
  const imagesJson = imageIds ? JSON.stringify(imageIds) : null;
  const stmt = d.prepare(`
    INSERT INTO conversations (session_id, user_id, role, content, sdk_session_id, project_path, images)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(sessionId, userId, role, content, sdkSessionId ?? null, projectPath ?? null, imagesJson);
  const row = d.prepare("SELECT * FROM conversations WHERE id = ?").get(info.lastInsertRowid) as Record<string, unknown>;
  return row;
}

export function updateMessage(messageId: number, content: string, sdkSessionId?: string): void {
  const d = getDb();
  if (sdkSessionId) {
    d.prepare("UPDATE conversations SET content = ?, sdk_session_id = ? WHERE id = ?")
      .run(content, sdkSessionId, messageId);
  } else {
    d.prepare("UPDATE conversations SET content = ? WHERE id = ?")
      .run(content, messageId);
  }
}

export function getConversationHistory(sessionId: string, limit: number = 50): Record<string, unknown>[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM conversations
    WHERE session_id = ?
    ORDER BY timestamp ASC, id ASC
    LIMIT ?
  `).all(sessionId, limit) as Record<string, unknown>[];

  return rows.map((row) => {
    const msg = { ...row };
    if (msg.images && typeof msg.images === "string") {
      try {
        const imageIds = JSON.parse(msg.images as string) as string[];
        msg.images = getMessageImages(imageIds);
      } catch {
        msg.images = [];
      }
    } else {
      msg.images = [];
    }
    return msg;
  });
}
