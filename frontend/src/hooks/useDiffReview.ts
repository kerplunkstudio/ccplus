import { useState, useEffect, useRef, useCallback } from 'react';
import { DiffResult } from '../types/index';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

export function useDiffReview(sessionId: string | undefined, streaming: boolean) {
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFileState] = useState<string | null>(null);
  const [commitMessage, setCommitMessageState] = useState('');
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [commitHash, setCommitHash] = useState<string | null>(null);

  const prevStreamingRef = useRef<boolean>(streaming);
  const prevSessionIdRef = useRef<string | undefined>(sessionId);

  const fetchDiff = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${SOCKET_URL}/api/sessions/${sessionId}/diff`);
      const json = await response.json();

      if (!response.ok || !json.success) {
        setError(json.error || 'Failed to load diff');
        setDiffResult(null);
      } else {
        setDiffResult(json.data);
        if (json.data.files.length > 0) {
          setSelectedFileState(json.data.files[0].path);
        }
      }
    } catch (err) {
      setError('Network error loading diff');
      setDiffResult(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const commit = useCallback(async () => {
    if (!sessionId || !commitMessage.trim()) return;

    setCommitting(true);
    setError(null);
    try {
      const response = await fetch(`${SOCKET_URL}/api/sessions/${sessionId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage }),
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setError(json.error || 'Failed to commit');
      } else {
        setCommitted(true);
        setCommitHash(json.commitHash || null);
      }
    } catch (err) {
      setError('Network error committing changes');
    } finally {
      setCommitting(false);
    }
  }, [sessionId, commitMessage]);

  const discard = useCallback(async () => {
    if (!sessionId) return;

    setError(null);
    try {
      const response = await fetch(`${SOCKET_URL}/api/sessions/${sessionId}/discard`, {
        method: 'POST',
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setError(json.error || 'Failed to discard changes');
      } else {
        await fetchDiff();
      }
    } catch (err) {
      setError('Network error discarding changes');
    }
  }, [sessionId, fetchDiff]);

  const selectFile = useCallback((path: string) => {
    setSelectedFileState(path);
  }, []);

  const setCommitMessage = useCallback((msg: string) => {
    setCommitMessageState(msg);
  }, []);

  const reset = useCallback(() => {
    setDiffResult(null);
    setLoading(false);
    setError(null);
    setSelectedFileState(null);
    setCommitMessageState('');
    setCommitting(false);
    setCommitted(false);
    setCommitHash(null);
  }, []);

  useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      reset();
      prevSessionIdRef.current = sessionId;
    }
  }, [sessionId, reset]);

  useEffect(() => {
    if (streaming) {
      setCommitted(false);
      setCommitHash(null);
    }
  }, [streaming]);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    const isNowIdle = !streaming;

    if (wasStreaming && isNowIdle && sessionId) {
      fetchDiff();
    }

    prevStreamingRef.current = streaming;
  }, [streaming, sessionId, fetchDiff]);

  return {
    diffResult,
    loading,
    error,
    selectedFile,
    commitMessage,
    committing,
    committed,
    commitHash,
    fetchDiff,
    commit,
    discard,
    selectFile,
    setCommitMessage,
    reset,
  };
}
