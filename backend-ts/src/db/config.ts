import { getDb } from "./connection.js";

/**
 * Get a single config value from the database
 */
export function getConfigValue(key: string): unknown | null {
  const d = getDb();
  const row = d.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  if (row) {
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Set a single config value in the database
 */
export function setConfigValue(key: string, value: unknown): void {
  const d = getDb();
  const valueJson = JSON.stringify(value);
  d.prepare(`
    INSERT INTO config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now', 'localtime')
  `).run(key, valueJson);
}

/**
 * Get all config values from the database and build nested object from dot-notation keys
 */
export function getAllConfig(): Record<string, unknown> {
  const d = getDb();
  const rows = d.prepare("SELECT key, value FROM config").all() as Array<{ key: string; value: string }>;

  const result: Record<string, unknown> = {};

  for (const row of rows) {
    try {
      const parsedValue = JSON.parse(row.value);
      const keys = row.key.split('.');

      let current: Record<string, unknown> = result;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!Object.prototype.hasOwnProperty.call(current, keys[i])) {
          current[keys[i]] = {};
        }
        current = current[keys[i]] as Record<string, unknown>;
      }

      current[keys[keys.length - 1]] = parsedValue;
    } catch {
      // Skip invalid JSON entries
    }
  }

  return result;
}

/**
 * Delete all config values from the database
 */
export function resetConfig(): void {
  const d = getDb();
  d.prepare("DELETE FROM config").run();
}
