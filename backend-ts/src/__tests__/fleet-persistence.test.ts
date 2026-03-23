import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Set test database path BEFORE importing modules that use it
const TEST_DB_PATH = path.join(process.cwd(), 'test-fleet.db');
const ORIGINAL_DB_PATH = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = TEST_DB_PATH;

// Now import modules (they will use the TEST_DB_PATH)
import * as fleetMonitor from '../fleet-monitor.js';
import { getDb, close } from '../database.js';

describe('Fleet Monitor - Database Persistence', () => {
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
    // Clear fleet monitor in-memory state before each test
    fleetMonitor._clearSessions();

    // Clear database fleet_sessions table
    const db = getDb();
    db.prepare('DELETE FROM fleet_sessions').run();
  });

  it('persists registered session to database', () => {
    fleetMonitor.registerSession('sess1', '/workspace/project1');

    const db = getDb();
    const row = db.prepare('SELECT * FROM fleet_sessions WHERE session_id = ?').get('sess1') as any;
    expect(row).toBeDefined();
    expect(row.session_id).toBe('sess1');
    expect(row.workspace).toBe('/workspace/project1');
    expect(row.status).toBe('idle');
    expect(row.tool_count).toBe(0);
  });

  it('updates database when status changes', () => {
    fleetMonitor.registerSession('sess1', '/workspace/project1');
    fleetMonitor.updateSessionStatus('sess1', 'running');

    const row = getDb().prepare('SELECT status FROM fleet_sessions WHERE session_id = ?').get('sess1') as any;
    expect(row.status).toBe('running');
  });

  it('updates database when tool count increments', () => {
    fleetMonitor.registerSession('sess1', '/workspace/project1');
    fleetMonitor.incrementToolCount('sess1');
    fleetMonitor.incrementToolCount('sess1');

    const row = getDb().prepare('SELECT tool_count FROM fleet_sessions WHERE session_id = ?').get('sess1') as any;
    expect(row.tool_count).toBe(2);
  });

  it('updates database when tokens are updated', () => {
    fleetMonitor.registerSession('sess1', '/workspace/project1');
    fleetMonitor.updateTokens('sess1', 100, 50);

    const row = getDb().prepare('SELECT input_tokens, output_tokens FROM fleet_sessions WHERE session_id = ?').get('sess1') as any;
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
  });

  it('updates database when agent count changes', () => {
    fleetMonitor.registerSession('sess1', '/workspace/project1');
    fleetMonitor.incrementAgentCount('sess1');
    fleetMonitor.incrementAgentCount('sess1');
    fleetMonitor.decrementAgentCount('sess1');

    const row = getDb().prepare('SELECT active_agents FROM fleet_sessions WHERE session_id = ?').get('sess1') as any;
    expect(row.active_agents).toBe(1);
  });

  it('stores files_touched as JSON', () => {
    fleetMonitor.registerSession('sess1', '/workspace/project1');
    fleetMonitor.addFileTouched('sess1', '/workspace/project1/file1.ts');
    fleetMonitor.addFileTouched('sess1', '/workspace/project1/file2.ts');

    const row = getDb().prepare('SELECT files_touched FROM fleet_sessions WHERE session_id = ?').get('sess1') as any;
    const files = JSON.parse(row.files_touched);
    expect(files).toEqual(['/workspace/project1/file1.ts', '/workspace/project1/file2.ts']);
  });

  it('stores label in database', () => {
    fleetMonitor.registerSession('sess1', '/workspace/project1');
    fleetMonitor.setLabel('sess1', 'Test session');

    const row = getDb().prepare('SELECT label FROM fleet_sessions WHERE session_id = ?').get('sess1') as any;
    expect(row.label).toBe('Test session');
  });

  it('stores requestedBy metadata', () => {
    fleetMonitor.registerSession('sess1', '/workspace/project1', {
      source: 'slack',
      sourceId: 'C12345',
    });

    const row = getDb().prepare('SELECT requested_by_source, requested_by_source_id FROM fleet_sessions WHERE session_id = ?').get('sess1') as any;
    expect(row.requested_by_source).toBe('slack');
    expect(row.requested_by_source_id).toBe('C12345');
  });

  it('loads sessions from database on startup', () => {
    // Directly insert sessions into the database
    getDb().prepare(`
      INSERT INTO fleet_sessions (
        session_id, status, workspace, tool_count, active_agents,
        input_tokens, output_tokens, duration_ms, started_at,
        last_activity, label, files_touched
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess1',
      'completed',
      '/workspace/project1',
      5,
      0,
      1000,
      500,
      30000,
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:05:00.000Z',
      'Loaded session',
      JSON.stringify(['/workspace/project1/file1.ts'])
    );

    getDb().prepare(`
      INSERT INTO fleet_sessions (
        session_id, status, workspace, tool_count, active_agents,
        input_tokens, output_tokens, duration_ms, started_at,
        last_activity, label, files_touched
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess2',
      'idle',
      '/workspace/project2',
      0,
      0,
      0,
      0,
      0,
      '2024-01-02T00:00:00.000Z',
      '2024-01-02T00:00:00.000Z',
      '',
      '[]'
    );

    // Load sessions from DB
    fleetMonitor.loadSessionsFromDb();

    // Verify sessions were loaded into memory
    const detail1 = fleetMonitor.getSessionDetail('sess1');
    expect(detail1).toBeDefined();
    expect(detail1?.sessionId).toBe('sess1');
    expect(detail1?.status).toBe('completed');
    expect(detail1?.toolCount).toBe(5);
    expect(detail1?.inputTokens).toBe(1000);
    expect(detail1?.outputTokens).toBe(500);
    expect(detail1?.label).toBe('Loaded session');
    expect(detail1?.filesTouched).toEqual(['/workspace/project1/file1.ts']);

    const detail2 = fleetMonitor.getSessionDetail('sess2');
    expect(detail2).toBeDefined();
    expect(detail2?.sessionId).toBe('sess2');
    expect(detail2?.status).toBe('idle');

    // Verify fleet state shows both sessions
    const state = fleetMonitor.getFleetState();
    expect(state.sessions).toHaveLength(2);
    expect(state.aggregate.totalSessions).toBe(2);
    expect(state.aggregate.totalToolCalls).toBe(5);
  });

  it('loads sessions with requestedBy metadata', () => {
    getDb().prepare(`
      INSERT INTO fleet_sessions (
        session_id, status, workspace, tool_count, active_agents,
        input_tokens, output_tokens, duration_ms, started_at,
        last_activity, label, files_touched, requested_by_source, requested_by_source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess1',
      'idle',
      '/workspace/project1',
      0,
      0,
      0,
      0,
      0,
      '2024-01-01T00:00:00.000Z',
      '2024-01-01T00:00:00.000Z',
      '',
      '[]',
      'slack',
      'C12345'
    );

    fleetMonitor.loadSessionsFromDb();

    const detail = fleetMonitor.getSessionDetail('sess1');
    expect(detail?.requestedBy).toEqual({
      source: 'slack',
      sourceId: 'C12345',
    });
  });

  it('survives restart (integration test)', () => {
    // Simulate first run: register and update sessions
    fleetMonitor.registerSession('sess1', '/workspace/project1');
    fleetMonitor.updateSessionStatus('sess1', 'running');
    fleetMonitor.incrementToolCount('sess1');
    fleetMonitor.incrementToolCount('sess1');
    fleetMonitor.updateTokens('sess1', 100, 50);
    fleetMonitor.setLabel('sess1', 'First session');

    // Simulate restart: clear memory and reload from DB
    fleetMonitor._clearSessions();
    fleetMonitor.loadSessionsFromDb();

    // Verify session was restored
    const detail = fleetMonitor.getSessionDetail('sess1');
    expect(detail).toBeDefined();
    expect(detail?.sessionId).toBe('sess1');
    expect(detail?.status).toBe('running');
    expect(detail?.toolCount).toBe(2);
    expect(detail?.inputTokens).toBe(100);
    expect(detail?.outputTokens).toBe(50);
    expect(detail?.label).toBe('First session');
  });
});
