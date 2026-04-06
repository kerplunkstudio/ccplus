import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Set test database path BEFORE importing modules that use it
const TEST_DB_PATH = path.join(process.cwd(), 'test-fleet-routes.db');
const ORIGINAL_DB_PATH = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = TEST_DB_PATH;

// Now import modules (they will use the TEST_DB_PATH)
import { getDb, close } from '../database.js';
import { upsertFleetSession } from '../db/fleet-sessions.js';
import type { FleetSessionInfo } from '../fleet-monitor.js';

describe('Fleet Routes - Database Integration', () => {
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

  describe('workflow_name column', () => {
    it('persists workflow_name to database', () => {
      const session = createSession({
        sessionId: 'test-workflow-persist',
        workflowName: 'bugfix',
      });

      const db = getDb();
      const row = db.prepare('SELECT workflow_name FROM fleet_sessions WHERE session_id = ?')
        .get('test-workflow-persist') as { workflow_name: string | null } | undefined;

      expect(row).toBeDefined();
      expect(row?.workflow_name).toBe('bugfix');
    });

    it('handles null workflow_name', () => {
      const session = createSession({
        sessionId: 'test-workflow-null',
        workflowName: undefined,
      });

      const db = getDb();
      const row = db.prepare('SELECT workflow_name FROM fleet_sessions WHERE session_id = ?')
        .get('test-workflow-null') as { workflow_name: string | null } | undefined;

      expect(row).toBeDefined();
      expect(row?.workflow_name).toBeNull();
    });

    it('updates workflow_name on upsert', () => {
      const session = createSession({
        sessionId: 'test-workflow-update',
        workflowName: 'feature',
      });

      // Update with new workflow name
      upsertFleetSession({
        ...session,
        workflowName: 'bugfix',
      });

      const db = getDb();
      const row = db.prepare('SELECT workflow_name FROM fleet_sessions WHERE session_id = ?')
        .get('test-workflow-update') as { workflow_name: string | null } | undefined;

      expect(row?.workflow_name).toBe('bugfix');
    });
  });
});
