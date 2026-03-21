import { getDb } from "./connection.js";

export function isFirstRun(): boolean {
  const d = getDb();
  const row = d.prepare(
    "SELECT COUNT(*) as c FROM conversations WHERE archived = 0 OR archived IS NULL"
  ).get() as { c: number };
  return row.c === 0;
}

export function cleanupOrphanedImages(): number {
  const d = getDb();
  const info = d.prepare(`
    DELETE FROM images
    WHERE session_id NOT IN (
      SELECT DISTINCT session_id FROM conversations
    )
  `).run();
  return info.changes;
}
