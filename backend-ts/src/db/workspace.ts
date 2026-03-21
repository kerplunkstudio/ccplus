import { getDb } from "./connection.js";

export function getWorkspaceState(userId: string): Record<string, unknown> | null {
  const d = getDb();
  const row = d.prepare("SELECT state FROM workspace_state WHERE user_id = ?").get(userId) as { state: string } | undefined;
  if (row) {
    try {
      return JSON.parse(row.state);
    } catch {
      return null;
    }
  }
  return null;
}

export function saveWorkspaceState(userId: string, state: Record<string, unknown>): void {
  const d = getDb();
  const stateJson = JSON.stringify(state);
  d.prepare(`
    INSERT INTO workspace_state (user_id, state)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      state = excluded.state,
      updated_at = datetime('now', 'localtime')
  `).run(userId, stateJson);
}
