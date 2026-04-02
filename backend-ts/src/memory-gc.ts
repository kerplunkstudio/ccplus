// Garbage collection for the memory server
// Prunes expired memories based on type-specific TTL rules

import { listMemories, deleteMemory } from './memory-client.js';
import { log } from './logger.js';

// TTL in milliseconds per memory type tag
const MEMORY_TTL_MS: Readonly<Record<string, number>> = {
  'type:task-summary': 30 * 24 * 60 * 60 * 1000,
  'type:files-modified': 14 * 24 * 60 * 60 * 1000,
  'type:errors-encountered': 7 * 24 * 60 * 60 * 1000,
  'type:agents-used': 14 * 24 * 60 * 60 * 1000,
  'type:decisions-lessons': 60 * 24 * 60 * 60 * 1000,
};

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface ParsedMemoryEntry {
  readonly hash: string;
  readonly created: string | null;
  readonly tags: string[];
}

export interface GcResult {
  readonly deleted: number;
  readonly checked: number;
  readonly errors: number;
}

/**
 * Parse the raw list output into structured entries.
 * The MCP memory_list returns formatted text with sections separated by ---
 * Each section has Hash:, Tags:, Created: fields.
 */
export function parseListOutput(text: string): ParsedMemoryEntry[] {
  if (!text || !text.trim()) {
    return [];
  }

  const sections = text.split(/\n---+\n/);
  const entries: ParsedMemoryEntry[] = [];

  for (const section of sections) {
    if (!section.trim()) {
      continue;
    }

    const hashMatch = section.match(/^Hash:\s*(\S+)/m);
    if (!hashMatch) {
      continue;
    }

    const hash = hashMatch[1].trim();

    const createdMatch = section.match(/^Created:\s*(.+)$/m);
    const created = createdMatch ? createdMatch[1].trim() : null;

    const tagsMatch = section.match(/^Tags:\s*(.+)$/m);
    const tags = tagsMatch
      ? tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    entries.push({ hash, created, tags });
  }

  return entries;
}

/**
 * Determine TTL for a memory based on its type tag
 */
export function getTtlMs(tags: string[]): number {
  for (const tag of tags) {
    if (MEMORY_TTL_MS[tag] !== undefined) {
      return MEMORY_TTL_MS[tag];
    }
  }
  return DEFAULT_TTL_MS;
}

/**
 * Check if a memory is expired based on its created date and type-specific TTL
 */
export function isExpired(entry: ParsedMemoryEntry, now: number): boolean {
  if (!entry.created) {
    return false;
  }
  const createdMs = new Date(entry.created).getTime();
  if (isNaN(createdMs)) {
    return false;
  }
  const ttl = getTtlMs(entry.tags);
  return (now - createdMs) > ttl;
}

/**
 * Run garbage collection: delete expired memories based on TTL rules.
 * Returns count of deleted memories.
 */
const GC_LIST_LIMIT = 500;

export async function runMemoryGC(): Promise<GcResult> {
  const startMs = performance.now();

  try {
    const rawList = await listMemories(undefined, GC_LIST_LIMIT);
    if (!rawList) {
      return { deleted: 0, checked: 0, errors: 0 };
    }

    const entries = parseListOutput(rawList);

    if (entries.length >= GC_LIST_LIMIT) {
      log.warn('Memory GC list hit limit — some entries may not be checked', {
        limit: GC_LIST_LIMIT,
        found: entries.length,
      });
    }
    const now = Date.now();
    let deleted = 0;
    let errors = 0;

    const expiredEntries = entries.filter((e) => isExpired(e, now));

    for (const entry of expiredEntries) {
      try {
        const success = await deleteMemory(entry.hash);
        if (success) {
          deleted++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }

    const durationMs = Math.round(performance.now() - startMs);
    log.info('Memory GC completed', {
      checked: entries.length,
      expired: expiredEntries.length,
      deleted,
      errors,
      durationMs,
    });

    return { deleted, checked: entries.length, errors };
  } catch (error) {
    log.error('Memory GC failed', { error: String(error) });
    return { deleted: 0, checked: 0, errors: 1 };
  }
}
