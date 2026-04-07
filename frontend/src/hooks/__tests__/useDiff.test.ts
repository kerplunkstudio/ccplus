import { renderHook, waitFor } from '@testing-library/react';
import { useDiff } from '../useDiff';
import type { DiffResult } from '../useDiff';

describe('useDiff', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('has correct initial state', () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useDiff('test-session-id'));

    expect(result.current.diffResult).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.selectedFile).toBeNull();
  });

  it('fetches diff successfully and auto-selects first file', async () => {
    const mockDiffResult: DiffResult = {
      files: [
        {
          path: 'src/test.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [
            {
              header: '@@ -1,3 +1,6 @@',
              oldStart: 1,
              oldCount: 3,
              newStart: 1,
              newCount: 6,
              lines: [
                { type: 'context', content: 'const x = 1;', oldLineNumber: 1, newLineNumber: 1 },
                { type: 'addition', content: 'const y = 2;', oldLineNumber: null, newLineNumber: 2 },
                { type: 'deletion', content: 'const z = 3;', oldLineNumber: 2, newLineNumber: null },
              ],
            },
          ],
        },
        {
          path: 'src/other.ts',
          status: 'added',
          additions: 3,
          deletions: 0,
          hunks: [],
        },
      ],
      totalAdditions: 8,
      totalDeletions: 2,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffResult,
    });

    const { result } = renderHook(() => useDiff('test-session-id'));

    result.current.fetchDiff();

    await waitFor(() => {
      expect(result.current.diffResult).toEqual(mockDiffResult);
    });

    expect(result.current.selectedFile).toBe('src/test.ts');
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('handles HTTP error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const { result } = renderHook(() => useDiff('test-session-id'));

    result.current.fetchDiff();

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to fetch diff: 500 Internal Server Error');
    });

    expect(result.current.diffResult).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('handles network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));

    const { result } = renderHook(() => useDiff('test-session-id'));

    result.current.fetchDiff();

    await waitFor(() => {
      expect(result.current.error).toBe('Network failure');
    });

    expect(result.current.diffResult).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('selectFile updates selectedFile', async () => {
    const mockDiffResult: DiffResult = {
      files: [
        {
          path: 'file1.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          hunks: [],
        },
        {
          path: 'file2.ts',
          status: 'added',
          additions: 5,
          deletions: 0,
          hunks: [],
        },
      ],
      totalAdditions: 6,
      totalDeletions: 1,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockDiffResult,
    });

    const { result } = renderHook(() => useDiff('test-session-id'));

    result.current.fetchDiff();

    await waitFor(() => {
      expect(result.current.selectedFile).toBe('file1.ts');
    });

    result.current.selectFile('file2.ts');

    await waitFor(() => {
      expect(result.current.selectedFile).toBe('file2.ts');
    });
  });

  it('resets state when sessionId changes', async () => {
    const mockDiffResult: DiffResult = {
      files: [
        {
          path: 'test.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
          hunks: [],
        },
      ],
      totalAdditions: 1,
      totalDeletions: 0,
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockDiffResult,
    });

    const { result, rerender } = renderHook(
      ({ sessionId }) => useDiff(sessionId),
      { initialProps: { sessionId: 'session-1' } }
    );

    await result.current.fetchDiff();

    await waitFor(() => {
      expect(result.current.diffResult).toEqual(mockDiffResult);
    });

    // Change sessionId
    rerender({ sessionId: 'session-2' });

    expect(result.current.diffResult).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.selectedFile).toBeNull();
  });
});
