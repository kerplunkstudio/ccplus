import { useState, useCallback, useEffect } from 'react';
import { SOCKET_URL } from '../config';

interface DiffLine {
  type: 'addition' | 'deletion' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  oldPath?: string;
}

interface DiffResult {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

interface UseDiffReturn {
  diffResult: DiffResult | null;
  loading: boolean;
  error: string | null;
  selectedFile: string | null;
  fetchDiff: () => Promise<void>;
  selectFile: (path: string) => void;
}

export type { DiffLine, DiffHunk, DiffFile, DiffResult };

export function useDiff(sessionId: string): UseDiffReturn {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Reset state when sessionId changes
  useEffect(() => {
    setDiffResult(null);
    setError(null);
    setSelectedFile(null);
  }, [sessionId]);

  const fetchDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${SOCKET_URL}/api/sessions/${sessionId}/diff`);
      if (!response.ok) {
        throw new Error(`Failed to fetch diff: ${response.status} ${response.statusText}`);
      }
      const envelope: { success: boolean; data?: DiffResult; error?: string } = await response.json();
      if (!envelope.success) {
        throw new Error(envelope.error ?? 'Failed to fetch diff');
      }
      const data = envelope.data!;
      setDiffResult(data);
      if (data.files.length > 0) {
        setSelectedFile(data.files[0].path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch diff');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const selectFile = useCallback((path: string) => {
    setSelectedFile(path);
  }, []);

  return { diffResult, loading, error, selectedFile, fetchDiff, selectFile };
}
