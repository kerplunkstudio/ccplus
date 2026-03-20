import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startSession } from '../session-api.js';
import { homedir } from 'os';
import path from 'path';

describe('session-api', () => {
  const mockDatabase = {
    recordMessage: vi.fn(),
    getConversationHistory: vi.fn(),
    incrementUserStats: vi.fn(),
  } as any;

  const mockSdkSession = {
    isActive: vi.fn(() => false),
    submitQuery: vi.fn(),
  } as any;

  const mockSessionWorkspaces = new Map<string, string>();

  const mockIO = {};

  const mockBuildSocketCallbacks = vi.fn(() => ({}));

  const mockLog = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as any;

  const dependencies = {
    database: mockDatabase,
    sdkSession: mockSdkSession,
    sessionWorkspaces: mockSessionWorkspaces,
    io: mockIO,
    buildSocketCallbacks: mockBuildSocketCallbacks,
    log: mockLog,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionWorkspaces.clear();
    mockDatabase.recordMessage.mockReturnValue({ id: 1 });
    mockDatabase.getConversationHistory.mockReturnValue([]);
    mockSdkSession.isActive.mockReturnValue(false);
  });

  describe('validation', () => {
    it('rejects empty prompt', () => {
      const result = startSession(
        { prompt: '', workspace: homedir() },
        dependencies
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('prompt is required');
    });

    it('rejects non-string prompt', () => {
      const result = startSession(
        { prompt: 123 as any, workspace: homedir() },
        dependencies
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('prompt is required');
    });

    it('rejects missing workspace', () => {
      const result = startSession(
        { prompt: 'test', workspace: '' },
        dependencies
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('workspace is required');
    });

    it('rejects workspace outside home directory', () => {
      const result = startSession(
        { prompt: 'test', workspace: '/tmp/test' },
        dependencies
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('within home directory');
    });

    it('rejects non-existent workspace', () => {
      const nonExistentPath = path.join(homedir(), 'nonexistent-workspace-12345');
      const result = startSession(
        { prompt: 'test', workspace: nonExistentPath },
        dependencies
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('rejects invalid session_id format', () => {
      const result = startSession(
        {
          prompt: 'test',
          workspace: homedir(),
          sessionId: 'invalid session id!' // Contains spaces and special chars
        },
        dependencies
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('alphanumeric');
    });

    it('accepts valid session_id with dots, dashes, underscores', () => {
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }]);
      const result = startSession(
        {
          prompt: 'test',
          workspace: homedir(),
          sessionId: 'valid-session.id_123'
        },
        dependencies
      );
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('valid-session.id_123');
    });

    it('rejects session_id longer than 128 characters', () => {
      const longId = 'a'.repeat(129);
      const result = startSession(
        {
          prompt: 'test',
          workspace: homedir(),
          sessionId: longId
        },
        dependencies
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('max 128 characters');
    });
  });

  describe('active session check', () => {
    it('rejects if session already has active query', () => {
      mockSdkSession.isActive.mockReturnValue(true);
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }]);

      const result = startSession(
        { prompt: 'test', workspace: homedir(), sessionId: 'active-session' },
        dependencies
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already has an active query');
    });
  });

  describe('successful session start', () => {
    it('generates UUID if no session_id provided', () => {
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }]);

      const result = startSession(
        { prompt: 'test prompt', workspace: homedir() },
        dependencies
      );

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it('records message in database', () => {
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }]);

      startSession(
        { prompt: 'test prompt', workspace: homedir() },
        dependencies
      );

      expect(mockDatabase.recordMessage).toHaveBeenCalledWith(
        expect.any(String),
        'local',
        'user',
        'test prompt',
        undefined,
        homedir(),
        undefined
      );
    });

    it('increments user stats for first message', () => {
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }]);

      startSession(
        { prompt: 'first message', workspace: homedir() },
        dependencies
      );

      expect(mockDatabase.incrementUserStats).toHaveBeenCalledWith('local', 1);
    });

    it('does not increment user stats for subsequent messages', () => {
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }, { id: 2 }]);

      startSession(
        { prompt: 'second message', workspace: homedir(), sessionId: 'existing' },
        dependencies
      );

      expect(mockDatabase.incrementUserStats).not.toHaveBeenCalled();
    });

    it('stores workspace in session map', () => {
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }]);

      const result = startSession(
        { prompt: 'test', workspace: homedir() },
        dependencies
      );

      expect(mockSessionWorkspaces.get(result.sessionId!)).toBe(homedir());
    });

    it('submits query to SDK', () => {
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }]);

      const result = startSession(
        { prompt: 'test prompt', workspace: homedir(), model: 'claude-opus-4' },
        dependencies
      );

      expect(mockSdkSession.submitQuery).toHaveBeenCalledWith(
        result.sessionId,
        'test prompt',
        homedir(),
        expect.any(Object),
        'claude-opus-4',
        undefined
      );
    });

    it('builds socket callbacks with correct parameters', () => {
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1 }]);

      const result = startSession(
        { prompt: 'test', workspace: homedir() },
        dependencies
      );

      expect(mockBuildSocketCallbacks).toHaveBeenCalledWith(result.sessionId, homedir());
    });
  });

  describe('error handling', () => {
    it('returns error if database write fails', () => {
      mockDatabase.recordMessage.mockImplementation(() => {
        throw new Error('Database write failed');
      });

      const result = startSession(
        { prompt: 'test', workspace: homedir() },
        dependencies
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to record message in database');
    });

    it('succeeds even if stat increment fails', () => {
      // Return 1 message (the one just recorded) to trigger incrementUserStats call
      mockDatabase.getConversationHistory.mockReturnValue([{ id: 1, content: 'test', role: 'user' }]);
      mockDatabase.incrementUserStats.mockImplementation(() => {
        throw new Error('Stat increment failed');
      });

      const result = startSession(
        { prompt: 'test', workspace: homedir() },
        dependencies
      );

      // Session should still succeed even if stats increment fails
      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      // Verify incrementUserStats was called (and threw)
      expect(mockDatabase.incrementUserStats).toHaveBeenCalledWith('local', 1);
    });
  });
});
