import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

// Mock the database module so importing session-import.ts does not require DB setup
vi.mock('../database.js', () => ({
  isSessionImported: vi.fn(),
  recordImportedSession: vi.fn(),
  insertImportedConversation: vi.fn(),
  insertImportedQueryUsage: vi.fn(),
  insertImportedToolUsage: vi.fn(),
}));

import { decodeFolderPath } from '../session-import.js';

describe('decodeFolderPath', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
  });

  describe('normal path with no hyphens in directory names', () => {
    it('returns naive decode when it exists on disk', () => {
      // -Users-matifuentes-Workspace => /Users/matifuentes/Workspace
      existsSyncSpy.mockImplementation((p) => p === '/Users/matifuentes/Workspace');

      const result = decodeFolderPath('-Users-matifuentes-Workspace');

      expect(result).toBe('/Users/matifuentes/Workspace');
    });
  });

  describe('path with hyphens in directory names', () => {
    it('resolves /Users/john-doe/Workspace when intermediate dirs exist', () => {
      // Naive decode would be /Users/john/doe/Workspace (wrong)
      // Correct path is /Users/john-doe/Workspace
      existsSyncSpy.mockImplementation((p) => {
        const validPaths = ['/Users', '/Users/john-doe', '/Users/john-doe/Workspace'];
        return validPaths.includes(p as string);
      });

      const result = decodeFolderPath('-Users-john-doe-Workspace');

      expect(result).toBe('/Users/john-doe/Workspace');
    });

    it('resolves /Users/john-doe/my-project when multiple components have hyphens', () => {
      existsSyncSpy.mockImplementation((p) => {
        const validPaths = ['/Users', '/Users/john-doe', '/Users/john-doe/my-project'];
        return validPaths.includes(p as string);
      });

      const result = decodeFolderPath('-Users-john-doe-my-project');

      expect(result).toBe('/Users/john-doe/my-project');
    });
  });

  describe('fallback when no valid path found', () => {
    it('returns naive decode when fs.existsSync always returns false', () => {
      existsSyncSpy.mockReturnValue(false);

      // -Users-john-doe-Workspace naive decode => /Users/john/doe/Workspace
      const result = decodeFolderPath('-Users-john-doe-Workspace');

      expect(result).toBe('/Users/john/doe/Workspace');
    });
  });

  describe('multiple hyphens in multiple path components', () => {
    it('resolves /Users/john-doe/my-project correctly', () => {
      existsSyncSpy.mockImplementation((p) => {
        const validPaths = ['/Users', '/Users/john-doe', '/Users/john-doe/my-project'];
        return validPaths.includes(p as string);
      });

      const result = decodeFolderPath('-Users-john-doe-my-project');

      expect(result).toBe('/Users/john-doe/my-project');
    });

    it('resolves /Users/a-b-c/d-e/f when existsSync confirms the right path', () => {
      existsSyncSpy.mockImplementation((p) => {
        const validPaths = ['/Users', '/Users/a-b-c', '/Users/a-b-c/d-e', '/Users/a-b-c/d-e/f'];
        return validPaths.includes(p as string);
      });

      const result = decodeFolderPath('-Users-a-b-c-d-e-f');

      expect(result).toBe('/Users/a-b-c/d-e/f');
    });
  });

  describe('single-segment path', () => {
    it('resolves -home to /home when it exists', () => {
      existsSyncSpy.mockImplementation((p) => p === '/home');

      const result = decodeFolderPath('-home');

      expect(result).toBe('/home');
    });

    it('falls back to /home even when it does not exist on disk', () => {
      existsSyncSpy.mockReturnValue(false);

      const result = decodeFolderPath('-home');

      // Naive decode of -home is /home
      expect(result).toBe('/home');
    });
  });

  describe('edge cases', () => {
    it('returns the input unchanged when it does not start with a hyphen', () => {
      const result = decodeFolderPath('/Users/matifuentes/Workspace');

      expect(result).toBe('/Users/matifuentes/Workspace');
      expect(existsSyncSpy).not.toHaveBeenCalled();
    });

    it('prefers naive decode (fast path) when it exists on disk', () => {
      // -Users-john-Workspace naive => /Users/john/Workspace exists, so return it immediately
      existsSyncSpy.mockImplementation((p) => p === '/Users/john/Workspace');

      const result = decodeFolderPath('-Users-john-Workspace');

      expect(result).toBe('/Users/john/Workspace');
    });
  });
});
