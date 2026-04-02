import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so these are available inside vi.mock factory closures
const { mockListMemories, mockDeleteMemory, mockLog } = vi.hoisted(() => {
  const mockListMemories = vi.fn();
  const mockDeleteMemory = vi.fn();
  const mockLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { mockListMemories, mockDeleteMemory, mockLog };
});

vi.mock('../memory-client.js', () => ({
  listMemories: mockListMemories,
  deleteMemory: mockDeleteMemory,
}));

vi.mock('../logger.js', () => ({
  log: mockLog,
}));

import {
  parseListOutput,
  getTtlMs,
  isExpired,
  runMemoryGC,
  type ParsedMemoryEntry,
} from '../memory-gc.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(
  hash: string,
  tags: string[],
  created: string | null
): ParsedMemoryEntry {
  return { hash, created, tags };
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function days(n: number): number {
  return n * 24 * 60 * 60 * 1000;
}

// ─── parseListOutput ────────────────────────────────────────────────────────

describe('parseListOutput', () => {
  it('returns empty array for empty input', () => {
    expect(parseListOutput('')).toEqual([]);
    expect(parseListOutput('   ')).toEqual([]);
  });

  it('parses a single section correctly', () => {
    const text = [
      'Hash: abc123',
      'Tags: type:task-summary, project:myapp',
      'Created: 2024-01-15T10:00:00Z',
      'Content: some memory text',
    ].join('\n');

    const entries = parseListOutput(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe('abc123');
    expect(entries[0].created).toBe('2024-01-15T10:00:00Z');
    expect(entries[0].tags).toContain('type:task-summary');
    expect(entries[0].tags).toContain('project:myapp');
  });

  it('parses multiple sections separated by ---', () => {
    const text = [
      'Hash: aaa111',
      'Tags: type:task-summary',
      'Created: 2024-01-01T00:00:00Z',
      '',
      '---',
      '',
      'Hash: bbb222',
      'Tags: type:errors-encountered',
      'Created: 2024-02-01T00:00:00Z',
    ].join('\n');

    const entries = parseListOutput(text);
    expect(entries).toHaveLength(2);
    expect(entries[0].hash).toBe('aaa111');
    expect(entries[1].hash).toBe('bbb222');
  });

  it('handles sections without Created field', () => {
    const text = 'Hash: xyz789\nTags: type:task-summary\n';
    const entries = parseListOutput(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].created).toBeNull();
  });

  it('handles sections without Tags field', () => {
    const text = 'Hash: xyz789\nCreated: 2024-01-01T00:00:00Z\n';
    const entries = parseListOutput(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].tags).toEqual([]);
  });

  it('skips sections without Hash field', () => {
    const text = [
      'Tags: type:task-summary',
      'Created: 2024-01-01T00:00:00Z',
      '',
      '---',
      '',
      'Hash: valid123',
      'Tags: type:task-summary',
      'Created: 2024-01-02T00:00:00Z',
    ].join('\n');

    const entries = parseListOutput(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe('valid123');
  });
});

// ─── getTtlMs ───────────────────────────────────────────────────────────────

describe('getTtlMs', () => {
  it('returns 30 days for type:task-summary', () => {
    expect(getTtlMs(['type:task-summary'])).toBe(days(30));
  });

  it('returns 14 days for type:files-modified', () => {
    expect(getTtlMs(['type:files-modified'])).toBe(days(14));
  });

  it('returns 7 days for type:errors-encountered', () => {
    expect(getTtlMs(['type:errors-encountered'])).toBe(days(7));
  });

  it('returns 14 days for type:agents-used', () => {
    expect(getTtlMs(['type:agents-used'])).toBe(days(14));
  });

  it('returns 60 days for type:decisions-lessons', () => {
    expect(getTtlMs(['type:decisions-lessons'])).toBe(days(60));
  });

  it('returns 90 days default for unknown type', () => {
    expect(getTtlMs(['type:unknown', 'project:foo'])).toBe(days(90));
  });

  it('returns 90 days default for empty tags', () => {
    expect(getTtlMs([])).toBe(days(90));
  });

  it('uses first matching type tag when multiple present', () => {
    // task-summary comes first → 30 days
    const ttl = getTtlMs(['type:task-summary', 'type:errors-encountered']);
    expect(ttl).toBe(days(30));
  });
});

// ─── isExpired ───────────────────────────────────────────────────────────────

describe('isExpired', () => {
  const now = Date.now();

  it('returns false when created is null', () => {
    const entry = makeEntry('h1', ['type:task-summary'], null);
    expect(isExpired(entry, now)).toBe(false);
  });

  it('returns false when created date is invalid', () => {
    const entry = makeEntry('h1', ['type:task-summary'], 'not-a-date');
    expect(isExpired(entry, now)).toBe(false);
  });

  it('returns false for fresh memory within TTL', () => {
    // 1 day old, TTL is 7 days for errors-encountered
    const entry = makeEntry('h1', ['type:errors-encountered'], isoAgo(days(1)));
    expect(isExpired(entry, now)).toBe(false);
  });

  it('returns true for memory past its TTL', () => {
    // 8 days old, TTL is 7 days for errors-encountered
    const entry = makeEntry('h1', ['type:errors-encountered'], isoAgo(days(8)));
    expect(isExpired(entry, now)).toBe(true);
  });

  it('returns false for memory just within default TTL', () => {
    // 89 days old, no type tag → 90 day default
    const entry = makeEntry('h1', [], isoAgo(days(89)));
    expect(isExpired(entry, now)).toBe(false);
  });

  it('returns true for memory past default TTL', () => {
    // 91 days old, no type tag → 90 day default
    const entry = makeEntry('h1', [], isoAgo(days(91)));
    expect(isExpired(entry, now)).toBe(true);
  });
});

// ─── runMemoryGC ─────────────────────────────────────────────────────────────

describe('runMemoryGC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts when listMemories returns empty string', async () => {
    mockListMemories.mockResolvedValue('');

    const result = await runMemoryGC();

    expect(result).toEqual({ deleted: 0, checked: 0, errors: 0 });
    expect(mockDeleteMemory).not.toHaveBeenCalled();
  });

  it('deletes only expired memories and returns correct counts', async () => {
    // One expired (8 days old, 7-day TTL), one fresh (1 day old, 7-day TTL)
    const rawList = [
      `Hash: expired1\nTags: type:errors-encountered\nCreated: ${isoAgo(days(8))}`,
      '---',
      `Hash: fresh1\nTags: type:errors-encountered\nCreated: ${isoAgo(days(1))}`,
    ].join('\n');

    mockListMemories.mockResolvedValue(rawList);
    mockDeleteMemory.mockResolvedValue(true);

    const result = await runMemoryGC();

    expect(result.checked).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockDeleteMemory).toHaveBeenCalledOnce();
    expect(mockDeleteMemory).toHaveBeenCalledWith('expired1');
  });

  it('counts delete failures as errors', async () => {
    const rawList = `Hash: h1\nTags: type:errors-encountered\nCreated: ${isoAgo(days(8))}`;

    mockListMemories.mockResolvedValue(rawList);
    mockDeleteMemory.mockResolvedValue(false);

    const result = await runMemoryGC();

    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('counts thrown errors during delete as errors', async () => {
    const rawList = `Hash: h1\nTags: type:errors-encountered\nCreated: ${isoAgo(days(8))}`;

    mockListMemories.mockResolvedValue(rawList);
    mockDeleteMemory.mockRejectedValue(new Error('delete failed'));

    const result = await runMemoryGC();

    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('returns errors:1 and does not throw when listMemories throws', async () => {
    mockListMemories.mockRejectedValue(new Error('connection failed'));

    const result = await runMemoryGC();

    expect(result).toEqual({ deleted: 0, checked: 0, errors: 1 });
    expect(mockLog.error).toHaveBeenCalledWith('Memory GC failed', expect.any(Object));
  });

  it('logs completion info after successful GC', async () => {
    const rawList = `Hash: h1\nTags: type:errors-encountered\nCreated: ${isoAgo(days(8))}`;

    mockListMemories.mockResolvedValue(rawList);
    mockDeleteMemory.mockResolvedValue(true);

    await runMemoryGC();

    expect(mockLog.info).toHaveBeenCalledWith(
      'Memory GC completed',
      expect.objectContaining({
        checked: 1,
        expired: 1,
        deleted: 1,
        errors: 0,
      })
    );
  });

  it('handles list with no expired entries', async () => {
    const rawList = `Hash: h1\nTags: type:task-summary\nCreated: ${isoAgo(days(1))}`;

    mockListMemories.mockResolvedValue(rawList);

    const result = await runMemoryGC();

    expect(result).toEqual({ deleted: 0, checked: 1, errors: 0 });
    expect(mockDeleteMemory).not.toHaveBeenCalled();
  });
});
