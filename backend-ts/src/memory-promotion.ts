/**
 * Memory access tracking and promotion/demotion logic for the tiered memory system.
 *
 * Tracks when long-term memories are accessed, auto-promotes frequently-used ones
 * to core memory, and demotes stale core entries.
 */

import { getDb } from './db/connection.js';
import { appendCoreMemory, loadCoreMemory, rethinkCoreMemory } from './captain-memory.js';
import { log } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryAccessEntry {
  readonly hash: string;
  readonly contentPreview: string;
  readonly tags: string;
  readonly accessCount: number;
  readonly accessCountRecent: number;
  readonly lastAccessedAt: number;
  readonly createdAt: number;
  readonly importanceScore: number;
  readonly promotedToCore: boolean;
  readonly sessionsSinceLastAccess: number;
  readonly pinned: boolean;
}

interface RawAccessRow {
  hash: string;
  content_preview: string;
  tags: string;
  access_count: number;
  access_count_recent: number;
  last_accessed_at: number;
  created_at: number;
  importance_score: number;
  promoted_to_core: number;
  sessions_since_last_access: number;
  pinned: number;
}

// ---------------------------------------------------------------------------
// Table init
// ---------------------------------------------------------------------------

/**
 * Ensures the memory_access_log table exists. Safe to call multiple times.
 */
export function initMemoryAccessLog(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_access_log (
      hash TEXT PRIMARY KEY,
      content_preview TEXT NOT NULL,
      tags TEXT DEFAULT '',
      access_count INTEGER DEFAULT 1,
      access_count_recent INTEGER DEFAULT 1,
      last_accessed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      importance_score REAL DEFAULT 0.5,
      promoted_to_core INTEGER DEFAULT 0,
      sessions_since_last_access INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0
    )
  `);
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToEntry(row: RawAccessRow): MemoryAccessEntry {
  return {
    hash: row.hash,
    contentPreview: row.content_preview,
    tags: row.tags,
    accessCount: row.access_count,
    accessCountRecent: row.access_count_recent,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    importanceScore: row.importance_score,
    promotedToCore: row.promoted_to_core === 1,
    sessionsSinceLastAccess: row.sessions_since_last_access,
    pinned: row.pinned === 1,
  };
}

// ---------------------------------------------------------------------------
// Access tracking
// ---------------------------------------------------------------------------

/**
 * Records that a long-term memory was accessed. Upserts the access log entry.
 */
export function recordMemoryAccess(hash: string, contentPreview: string, tags: string): void {
  const db = getDb();
  const now = Date.now();

  const existing = db.prepare('SELECT hash, access_count, access_count_recent FROM memory_access_log WHERE hash = ?').get(hash) as
    | { hash: string; access_count: number; access_count_recent: number }
    | undefined;

  if (existing) {
    const newAccessCount = existing.access_count + 1;
    const newAccessCountRecent = existing.access_count_recent + 1;
    const score = computeImportanceScore(tags, newAccessCount, newAccessCountRecent);
    db.prepare(`
      UPDATE memory_access_log
      SET access_count = ?,
          access_count_recent = ?,
          last_accessed_at = ?,
          importance_score = ?
      WHERE hash = ?
    `).run(newAccessCount, newAccessCountRecent, now, score, hash);
  } else {
    const score = computeImportanceScore(tags, 1, 1);
    db.prepare(`
      INSERT INTO memory_access_log
        (hash, content_preview, tags, access_count, access_count_recent, last_accessed_at, created_at, importance_score)
      VALUES (?, ?, ?, 1, 1, ?, ?, ?)
    `).run(hash, contentPreview, tags, now, now, score);
  }
}

// ---------------------------------------------------------------------------
// Promotion candidates
// ---------------------------------------------------------------------------

/**
 * Returns entries that have been accessed frequently enough to promote to core memory.
 */
export function getPromotionCandidates(): MemoryAccessEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM memory_access_log
    WHERE access_count_recent >= 3 AND promoted_to_core = 0
    ORDER BY access_count_recent DESC
    LIMIT 5
  `).all() as RawAccessRow[];
  return rows.map(rowToEntry);
}

/**
 * Marks an entry as promoted to core memory.
 */
export function markAsPromoted(hash: string): void {
  const db = getDb();
  db.prepare('UPDATE memory_access_log SET promoted_to_core = 1 WHERE hash = ?').run(hash);
}

// ---------------------------------------------------------------------------
// Demotion candidates
// ---------------------------------------------------------------------------

/**
 * Returns entries that have been in core memory but are now stale.
 */
export function getDemotionCandidates(): MemoryAccessEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM memory_access_log
    WHERE promoted_to_core = 1 AND sessions_since_last_access >= 10
    ORDER BY sessions_since_last_access DESC
  `).all() as RawAccessRow[];
  return rows.map(rowToEntry);
}

/**
 * Marks an entry as demoted from core memory.
 */
export function markAsDemoted(hash: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE memory_access_log
    SET promoted_to_core = 0, sessions_since_last_access = 0
    WHERE hash = ?
  `).run(hash);
}

// ---------------------------------------------------------------------------
// Staleness decay
// ---------------------------------------------------------------------------

/**
 * Increments staleness counters for all entries. Implements decay on recent access counts.
 * Call once per session start or on a schedule.
 */
export function incrementSessionStaleness(): void {
  const db = getDb();
  db.prepare(`
    UPDATE memory_access_log
    SET sessions_since_last_access = sessions_since_last_access + 1,
        access_count_recent = MAX(0, access_count_recent - 1)
  `).run();
}

// ---------------------------------------------------------------------------
// Importance scoring
// ---------------------------------------------------------------------------

/**
 * Computes a heuristic importance score based on tags and access frequency.
 * Returns a value capped at 1.0.
 */
export function computeImportanceScore(
  tags: string,
  accessCount: number,
  accessCountRecent: number,
): number {
  let score = 0.3;

  if (tags.includes('type:decisions-lessons')) score += 0.2;
  if (tags.includes('type:task-summary')) score += 0.1;
  if (tags.includes('type:errors-encountered')) score += 0.1;
  if (accessCountRecent >= 3) score += 0.2;
  if (accessCountRecent >= 5) score += 0.1;

  // accessCount provides a small lifetime signal; cap contribution at 0.05
  if (accessCount >= 10) score += 0.05;

  return Math.min(1.0, score);
}

// ---------------------------------------------------------------------------
// Promotion sweep
// ---------------------------------------------------------------------------

const LESSONS_BLOCK_LIMIT = 1000;

/**
 * Runs the full promotion/demotion sweep. Promotes frequently-accessed long-term
 * memories to core memory lessons, and removes stale promoted entries.
 *
 * @returns Counts of promoted and demoted entries.
 */
export function runPromotionSweep(): { readonly promoted: number; readonly demoted: number } {
  let promoted = 0;
  let demoted = 0;

  // --- Promotions ---
  const candidates = getPromotionCandidates();

  for (const entry of candidates) {
    try {
      const core = loadCoreMemory();
      const lessonsLength = core.lessons.length;
      const previewLength = entry.contentPreview.length;
      const separatorLength = lessonsLength > 0 ? 1 : 0; // '\n'

      if (lessonsLength + separatorLength + previewLength > LESSONS_BLOCK_LIMIT) {
        log.debug('memory-promotion: skipping candidate — lessons block full', { hash: entry.hash });
        continue;
      }

      const result = appendCoreMemory('lessons', entry.contentPreview);
      if (!result.success) {
        log.warn('memory-promotion: failed to append to lessons block', {
          hash: entry.hash,
          error: result.error,
        });
        continue;
      }

      markAsPromoted(entry.hash);
      promoted++;
      log.info('memory-promotion: promoted entry to core memory', { hash: entry.hash });
    } catch (error) {
      log.error('memory-promotion: error promoting entry', { hash: entry.hash, error: String(error) });
    }
  }

  // --- Demotions ---
  const staleEntries = getDemotionCandidates();

  for (const entry of staleEntries) {
    try {
      const core = loadCoreMemory();
      if (!core.lessons.includes(entry.contentPreview)) {
        // Already removed from core — just update the flag
        markAsDemoted(entry.hash);
        demoted++;
        continue;
      }

      const updated = core.lessons.replace(entry.contentPreview, '').replace(/^\n|\n$/g, '').replace(/\n{2,}/g, '\n');
      const result = rethinkCoreMemory('lessons', updated);
      if (!result.success) {
        log.warn('memory-promotion: failed to remove stale entry from lessons block', {
          hash: entry.hash,
          error: result.error,
        });
        continue;
      }

      markAsDemoted(entry.hash);
      demoted++;
      log.info('memory-promotion: demoted stale entry from core memory', { hash: entry.hash });
    } catch (error) {
      log.error('memory-promotion: error demoting entry', { hash: entry.hash, error: String(error) });
    }
  }

  return { promoted, demoted };
}
