/**
 * Regression tests for Fix #1: removeSession() cleans up the sessions Map.
 *
 * Before the fix, streamQuery had no mechanism to remove completed sessions
 * from the Map, causing unbounded memory growth. removeSession() was added and
 * called from streamQuery's finally block.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sessions, getOrCreateSession, removeSession } from '../sdk/session-manager.js';

describe('session-manager — removeSession (regression Fix #1)', () => {
  beforeEach(() => {
    // Clean up any sessions left by previous tests
    sessions.clear();
  });

  it('removeSession deletes the session from the Map', () => {
    getOrCreateSession('test-session-1', '/workspace/a');
    expect(sessions.has('test-session-1')).toBe(true);

    removeSession('test-session-1');

    expect(sessions.has('test-session-1')).toBe(false);
  });

  it('removeSession is a no-op for a session that does not exist', () => {
    expect(() => removeSession('nonexistent-session')).not.toThrow();
    expect(sessions.size).toBe(0);
  });

  it('removeSession only deletes the targeted session, not others', () => {
    getOrCreateSession('sess-a', '/workspace/a');
    getOrCreateSession('sess-b', '/workspace/b');
    getOrCreateSession('sess-c', '/workspace/c');

    removeSession('sess-b');

    expect(sessions.has('sess-a')).toBe(true);
    expect(sessions.has('sess-b')).toBe(false);
    expect(sessions.has('sess-c')).toBe(true);
  });

  it('sessions Map grows when sessions are created and shrinks when removed', () => {
    expect(sessions.size).toBe(0);

    getOrCreateSession('s1', '/workspace/s1');
    getOrCreateSession('s2', '/workspace/s2');
    expect(sessions.size).toBe(2);

    removeSession('s1');
    expect(sessions.size).toBe(1);

    removeSession('s2');
    expect(sessions.size).toBe(0);
  });
});
