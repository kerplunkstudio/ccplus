import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { addCorrelation, getCorrelationsForSession, getCorrelationChain } from '../db/kairos.js';
import { getDb } from '../db/connection.js';

describe('Captain KAIROS Integration', () => {
  beforeEach(() => {
    // Clean up correlations table before each test
    const db = getDb();
    db.prepare('DELETE FROM kairos_correlations').run();
  });

  afterEach(() => {
    // Clean up after tests
    const db = getDb();
    db.prepare('DELETE FROM kairos_correlations').run();
  });

  describe('addCorrelation', () => {
    it('creates a bug_fix_for correlation', () => {
      addCorrelation({
        sourceSessionId: 'feat-auth-login',
        targetSessionId: 'fix-auth-type-error',
        relationType: 'bug_fix_for',
        confidence: 1.0,
        evidence: 'Captain tagged as bug fix for feat-auth-login',
      });

      const correlations = getCorrelationsForSession('feat-auth-login');
      expect(correlations).toHaveLength(1);
      expect(correlations[0].source_session_id).toBe('feat-auth-login');
      expect(correlations[0].target_session_id).toBe('fix-auth-type-error');
      expect(correlations[0].relation_type).toBe('bug_fix_for');
      expect(correlations[0].confidence).toBe(1.0);
      expect(correlations[0].evidence).toBe('Captain tagged as bug fix for feat-auth-login');
    });

    it('does not create duplicate correlations', () => {
      const params = {
        sourceSessionId: 'sess-a',
        targetSessionId: 'sess-b',
        relationType: 'bug_fix_for',
        confidence: 1.0,
        evidence: 'Test',
      };

      addCorrelation(params);
      addCorrelation(params); // Try to add duplicate

      const correlations = getCorrelationsForSession('sess-a');
      expect(correlations).toHaveLength(1);
    });
  });

  describe('getCorrelationChain', () => {
    it('follows a chain of bug fixes', () => {
      // Scenario: feat-a introduced a bug, fix-b fixed it, but fix-b introduced another bug, fix-c fixed that
      addCorrelation({
        sourceSessionId: 'feat-a',
        targetSessionId: 'fix-b',
        relationType: 'bug_fix_for',
        confidence: 1.0,
        evidence: 'Fixed feat-a bug',
      });

      addCorrelation({
        sourceSessionId: 'fix-b',
        targetSessionId: 'fix-c',
        relationType: 'bug_fix_for',
        confidence: 1.0,
        evidence: 'Fixed fix-b regression',
      });

      const chain = getCorrelationChain('feat-a');
      expect(chain).toHaveLength(2);
      expect(chain[0].source_session_id).toBe('feat-a');
      expect(chain[0].target_session_id).toBe('fix-b');
      expect(chain[1].source_session_id).toBe('fix-b');
      expect(chain[1].target_session_id).toBe('fix-c');
    });

    it('returns empty array for session with no correlations', () => {
      const chain = getCorrelationChain('nonexistent-session');
      expect(chain).toHaveLength(0);
    });
  });

  describe('getCorrelationsForSession', () => {
    it('returns correlations where session is source', () => {
      addCorrelation({
        sourceSessionId: 'sess-a',
        targetSessionId: 'sess-b',
        relationType: 'bug_fix_for',
        confidence: 1.0,
        evidence: 'Test',
      });

      const correlations = getCorrelationsForSession('sess-a');
      expect(correlations).toHaveLength(1);
      expect(correlations[0].source_session_id).toBe('sess-a');
    });

    it('returns correlations where session is target', () => {
      addCorrelation({
        sourceSessionId: 'sess-a',
        targetSessionId: 'sess-b',
        relationType: 'bug_fix_for',
        confidence: 1.0,
        evidence: 'Test',
      });

      const correlations = getCorrelationsForSession('sess-b');
      expect(correlations).toHaveLength(1);
      expect(correlations[0].target_session_id).toBe('sess-b');
    });

    it('returns correlations where session appears in both source and target', () => {
      addCorrelation({
        sourceSessionId: 'sess-a',
        targetSessionId: 'sess-b',
        relationType: 'bug_fix_for',
        confidence: 1.0,
        evidence: 'Test 1',
      });

      addCorrelation({
        sourceSessionId: 'sess-b',
        targetSessionId: 'sess-c',
        relationType: 'bug_fix_for',
        confidence: 1.0,
        evidence: 'Test 2',
      });

      const correlations = getCorrelationsForSession('sess-b');
      expect(correlations).toHaveLength(2);
    });
  });
});
