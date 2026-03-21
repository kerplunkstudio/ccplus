import { getDb } from "./connection.js";

export function storeImage(imageId: string, filename: string, mimeType: string, size: number, data: Buffer, sessionId: string): Record<string, unknown> {
  const d = getDb();
  d.prepare(`
    INSERT INTO images (id, filename, mime_type, size, data, session_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(imageId, filename, mimeType, size, data, sessionId);
  return {
    id: imageId,
    filename,
    mime_type: mimeType,
    size,
    url: `/api/images/${imageId}`,
  };
}

export function getImage(imageId: string): Record<string, unknown> | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM images WHERE id = ?").get(imageId) as Record<string, unknown> | undefined;
  return row ?? null;
}

export function getMessageImages(imageIds: string[]): Record<string, unknown>[] {
  if (!imageIds.length) return [];
  const d = getDb();
  const placeholders = imageIds.map(() => "?").join(",");
  const rows = d.prepare(
    `SELECT id, filename, mime_type, size FROM images WHERE id IN (${placeholders})`
  ).all(...imageIds) as Record<string, unknown>[];
  return rows.map((row) => ({
    ...row,
    url: `/api/images/${(row as { id: string }).id}`,
  }));
}
