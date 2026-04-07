import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Set test database path BEFORE importing modules that use it
const TEST_DB_PATH = path.join(process.cwd(), 'test-fleet-sessions-api.db');
const ORIGINAL_DB_PATH = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = TEST_DB_PATH;

// Now import modules (they will use the TEST_DB_PATH)
import { getDb, close } from '../database.js';
import {
  getFilteredFleetSessions,
  getFleetFilterValues,
  getFleetSession,
  updateSessionMergeCommitHash,
  upsertFleetSession,
  type FleetSessionFilters,
} from '../db/fleet-sessions.js';
import type { FleetSessionInfo } from '../fleet-monitor.js';

describe('Fleet Sessions API - Filtered/Paginated Queries', () => {
  beforeAll(() => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  afterAll(() => {
    close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    // Cleanup WAL files
    const walPath = TEST_DB_PATH + '-wal';
    const shmPath = TEST_DB_PATH + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

    // Restore original DATABASE_PATH
    if (ORIGINAL_DB_PATH) {
      process.env.DATABASE_PATH = ORIGINAL_DB_PATH;
    } else {
      delete process.env.DATABASE_PATH;
    }
  });

  beforeEach(() => {
    // Clear database fleet_sessions table
    const db = getDb();
    db.prepare('DELETE FROM fleet_sessions').run();
  });

  function createSession(overrides: Partial<FleetSessionInfo> = {}): FleetSessionInfo {
    const base: FleetSessionInfo = {
      sessionId: 'sess-' + Math.random().toString(36).substring(7),
      status: 'completed',
      workspace: '/workspace/project1',
      toolCount: 10,
      activeAgents: 0,
      totalAgents: 3,
      inputTokens: 1000,
      outputTokens: 500,
      durationMs: 60000,
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      label: 'Test session',
      filesTouched: [],
      sessionNumber: 1,
      ...overrides,
    };
    upsertFleetSession(base);
    return base;
  }

  describe('getFilteredFleetSessions', () => {
    it('returns all sessions when no filters provided', () => {
      createSession({ sessionId: 'sess1' });
      createSession({ sessionId: 'sess2' });
      createSession({ sessionId: 'sess3' });

      const result = getFilteredFleetSessions({});

      expect(result.sessions).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('filters by status (single)', () => {
      createSession({ sessionId: 'sess1', status: 'completed' });
      createSession({ sessionId: 'sess2', status: 'failed' });
      createSession({ sessionId: 'sess3', status: 'running' });

      const result = getFilteredFleetSessions({ status: ['completed'] });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('sess1');
      expect(result.total).toBe(1);
    });

    it('filters by status (multiple)', () => {
      createSession({ sessionId: 'sess1', status: 'completed' });
      createSession({ sessionId: 'sess2', status: 'failed' });
      createSession({ sessionId: 'sess3', status: 'running' });
      createSession({ sessionId: 'sess4', status: 'cancelled' });

      const result = getFilteredFleetSessions({ status: ['completed', 'failed'] });

      expect(result.sessions).toHaveLength(2);
      expect(result.total).toBe(2);
      const ids = result.sessions.map(s => s.sessionId).sort();
      expect(ids).toEqual(['sess1', 'sess2']);
    });

    it('filters by workspace (partial match)', () => {
      createSession({ sessionId: 'sess1', workspace: '/Users/foo/project1' });
      createSession({ sessionId: 'sess2', workspace: '/Users/foo/project2' });
      createSession({ sessionId: 'sess3', workspace: '/Users/bar/project1' });

      const result = getFilteredFleetSessions({ workspace: 'foo' });

      expect(result.sessions).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('filters by workflow name (exact match)', () => {
      createSession({ sessionId: 'sess1', workflowName: 'bugfix' });
      createSession({ sessionId: 'sess2', workflowName: 'feature' });
      createSession({ sessionId: 'sess3', workflowName: 'bugfix' });

      const result = getFilteredFleetSessions({ workflowName: 'bugfix' });

      expect(result.sessions).toHaveLength(2);
      expect(result.total).toBe(2);
      const ids = result.sessions.map(s => s.sessionId).sort();
      expect(ids).toEqual(['sess1', 'sess3']);
    });

    it('combines multiple filters', () => {
      createSession({ sessionId: 'sess1', status: 'completed', workspace: '/Users/foo/project1', workflowName: 'bugfix' });
      createSession({ sessionId: 'sess2', status: 'failed', workspace: '/Users/foo/project2', workflowName: 'bugfix' });
      createSession({ sessionId: 'sess3', status: 'completed', workspace: '/Users/bar/project1', workflowName: 'bugfix' });
      createSession({ sessionId: 'sess4', status: 'completed', workspace: '/Users/foo/project1', workflowName: 'feature' });

      const filters: FleetSessionFilters = {
        status: ['completed'],
        workspace: 'foo',
        workflowName: 'bugfix',
      };

      const result = getFilteredFleetSessions(filters);

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].sessionId).toBe('sess1');
      expect(result.total).toBe(1);
    });

    it('paginates results', () => {
      // Create 25 sessions
      for (let i = 1; i <= 25; i++) {
        createSession({ sessionId: `sess${i}` });
      }

      // Page 1: default limit 20
      const page1 = getFilteredFleetSessions({ page: 1, limit: 20 });
      expect(page1.sessions).toHaveLength(20);
      expect(page1.total).toBe(25);
      expect(page1.page).toBe(1);

      // Page 2: remaining 5
      const page2 = getFilteredFleetSessions({ page: 2, limit: 20 });
      expect(page2.sessions).toHaveLength(5);
      expect(page2.total).toBe(25);
      expect(page2.page).toBe(2);
    });

    it('handles custom page size', () => {
      for (let i = 1; i <= 15; i++) {
        createSession({ sessionId: `sess${i}` });
      }

      const result = getFilteredFleetSessions({ page: 1, limit: 5 });

      expect(result.sessions).toHaveLength(5);
      expect(result.total).toBe(15);
      expect(result.limit).toBe(5);
    });

    it('orders by started_at DESC', () => {
      const now = Date.now();
      createSession({ sessionId: 'sess1', startedAt: new Date(now - 3000).toISOString() });
      createSession({ sessionId: 'sess2', startedAt: new Date(now - 1000).toISOString() });
      createSession({ sessionId: 'sess3', startedAt: new Date(now - 2000).toISOString() });

      const result = getFilteredFleetSessions({});

      expect(result.sessions[0].sessionId).toBe('sess2'); // most recent
      expect(result.sessions[1].sessionId).toBe('sess3');
      expect(result.sessions[2].sessionId).toBe('sess1'); // oldest
    });

    it('handles empty result set', () => {
      createSession({ sessionId: 'sess1', status: 'completed' });

      const result = getFilteredFleetSessions({ status: ['running'] });

      expect(result.sessions).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('defaults to page 1 and limit 20', () => {
      createSession({ sessionId: 'sess1' });

      const result = getFilteredFleetSessions({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('includes all FleetSessionInfo fields', () => {
      const session = createSession({
        sessionId: 'sess1',
        status: 'completed',
        workspace: '/workspace/project1',
        toolCount: 42,
        activeAgents: 0,
        totalAgents: 3,
        inputTokens: 1000,
        outputTokens: 500,
        durationMs: 60000,
        label: 'Test label',
        filesTouched: ['file1.ts', 'file2.ts'],
        requestedBy: { source: 'captain', sourceId: 'captain-123' },
        description: 'Test description',
        sessionNumber: 5,
        workflowName: 'bugfix',
      });

      const result = getFilteredFleetSessions({});

      const retrieved = result.sessions[0];
      expect(retrieved.sessionId).toBe('sess1');
      expect(retrieved.status).toBe('completed');
      expect(retrieved.workspace).toBe('/workspace/project1');
      expect(retrieved.toolCount).toBe(42);
      expect(retrieved.totalAgents).toBe(3);
      expect(retrieved.inputTokens).toBe(1000);
      expect(retrieved.outputTokens).toBe(500);
      expect(retrieved.filesTouched).toEqual(['file1.ts', 'file2.ts']);
      expect(retrieved.requestedBy).toEqual({ source: 'captain', sourceId: 'captain-123' });
      expect(retrieved.description).toBe('Test description');
      expect(retrieved.sessionNumber).toBe(5);
      expect(retrieved.workflowName).toBe('bugfix');
    });
  });

  describe('getFleetFilterValues', () => {
    it('returns distinct statuses', () => {
      createSession({ status: 'completed' });
      createSession({ status: 'failed' });
      createSession({ status: 'completed' });
      createSession({ status: 'running' });

      const values = getFleetFilterValues();

      expect(values.statuses).toHaveLength(3);
      expect(values.statuses).toContain('completed');
      expect(values.statuses).toContain('failed');
      expect(values.statuses).toContain('running');
    });

    it('returns distinct workspaces', () => {
      createSession({ workspace: '/workspace/project1' });
      createSession({ workspace: '/workspace/project2' });
      createSession({ workspace: '/workspace/project1' });

      const values = getFleetFilterValues();

      expect(values.workspaces).toHaveLength(2);
      expect(values.workspaces).toContain('/workspace/project1');
      expect(values.workspaces).toContain('/workspace/project2');
    });

    it('returns distinct workflow names', () => {
      createSession({ workflowName: 'bugfix' });
      createSession({ workflowName: 'feature' });
      createSession({ workflowName: 'bugfix' });
      createSession({ workflowName: undefined });

      const values = getFleetFilterValues();

      expect(values.workflowNames).toHaveLength(2);
      expect(values.workflowNames).toContain('bugfix');
      expect(values.workflowNames).toContain('feature');
    });

    it('returns empty arrays when no sessions exist', () => {
      const values = getFleetFilterValues();

      expect(values.statuses).toEqual([]);
      expect(values.workspaces).toEqual([]);
      expect(values.workflowNames).toEqual([]);
    });

    it('orders values alphabetically', () => {
      createSession({ status: 'running' });
      createSession({ status: 'completed' });
      createSession({ status: 'failed' });

      const values = getFleetFilterValues();

      expect(values.statuses).toEqual(['completed', 'failed', 'running']);
    });
  });

  describe('SQL injection prevention', () => {
    it('handles malicious status filter', () => {
      createSession({ sessionId: 'sess1', status: 'completed' });

      const filters: FleetSessionFilters = {
        status: ["completed' OR '1'='1"],
      };

      const result = getFilteredFleetSessions(filters);

      // Should not match anything because parameterized query prevents injection
      expect(result.sessions).toHaveLength(0);
    });

    it('handles malicious workspace filter', () => {
      createSession({ sessionId: 'sess1', workspace: '/workspace/project1' });

      const filters: FleetSessionFilters = {
        workspace: "' OR 1=1 --",
      };

      const result = getFilteredFleetSessions(filters);

      // Should not match because LIKE uses parameterized query
      expect(result.sessions).toHaveLength(0);
    });

    it('handles malicious workflow name filter', () => {
      createSession({ sessionId: 'sess1', workflowName: 'bugfix' });

      const filters: FleetSessionFilters = {
        workflowName: "bugfix' OR '1'='1",
      };

      const result = getFilteredFleetSessions(filters);

      // Should not match because parameterized query prevents injection
      expect(result.sessions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Regression tests for updateSessionMergeCommitHash / getFleetSession
  // These cover the diff-viewer "No changes" bug fix (migration v20).
  // -------------------------------------------------------------------------

  describe('updateSessionMergeCommitHash', () => {
    it('persists the merge commit hash and getFleetSession returns it', () => {
      createSession({ sessionId: 'merge-sess-1' });

      updateSessionMergeCommitHash('merge-sess-1', 'abc1234');

      const retrieved = getFleetSession('merge-sess-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.mergeCommitHash).toBe('abc1234');
    });

    it('overwrites a previously stored merge commit hash', () => {
      createSession({ sessionId: 'merge-sess-2' });

      updateSessionMergeCommitHash('merge-sess-2', 'first111');
      updateSessionMergeCommitHash('merge-sess-2', 'second22');

      const retrieved = getFleetSession('merge-sess-2');
      expect(retrieved!.mergeCommitHash).toBe('second22');
    });

    it('does not affect other session fields when setting hash', () => {
      createSession({ sessionId: 'merge-sess-3', label: 'keep-me', status: 'completed' });

      updateSessionMergeCommitHash('merge-sess-3', 'deadbeef');

      const retrieved = getFleetSession('merge-sess-3');
      expect(retrieved!.label).toBe('keep-me');
      expect(retrieved!.status).toBe('completed');
      expect(retrieved!.mergeCommitHash).toBe('deadbeef');
    });

    it('is a no-op for a session that does not exist (no throw)', () => {
      expect(() => {
        updateSessionMergeCommitHash('nonexistent-session-id', 'abc1234');
      }).not.toThrow();
    });

    it('getFleetSession returns undefined mergeCommitHash when never set', () => {
      createSession({ sessionId: 'no-hash-sess' });

      const retrieved = getFleetSession('no-hash-sess');
      expect(retrieved!.mergeCommitHash).toBeUndefined();
    });
  });
});
