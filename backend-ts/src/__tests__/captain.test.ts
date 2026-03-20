import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as captain from '../captain.js';

describe('Captain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isCaptainSession', () => {
    it('returns true for captain session IDs', () => {
      expect(captain.isCaptainSession('captain-1234567890')).toBe(true);
      expect(captain.isCaptainSession('captain-test')).toBe(true);
    });

    it('returns false for non-captain session IDs', () => {
      expect(captain.isCaptainSession('session-123')).toBe(false);
      expect(captain.isCaptainSession('test-session')).toBe(false);
      expect(captain.isCaptainSession('captain')).toBe(false);
      expect(captain.isCaptainSession('captains-log')).toBe(false);
    });
  });

  describe('getCaptainSessionId', () => {
    it('returns null when Captain is not running', () => {
      const sessionId = captain.getCaptainSessionId();
      expect(sessionId).toBeNull();
    });
  });

  describe('sendCaptainMessage', () => {
    it('throws when Captain is not active', () => {
      expect(() => captain.sendCaptainMessage('test message', 'web', 'test-id')).toThrow('Captain session is not active');
    });
  });
});
