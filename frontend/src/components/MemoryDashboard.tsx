import React, { useState, useEffect, useCallback, useRef } from 'react';
import './MemoryDashboard.css';

interface Memory {
  hash: string;
  title: string;
  content: string;
  preview: string;
  tags: string[];
  created: string | null;
}

interface DistillationStats {
  total: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  successRate: number;
}

interface RecentDistillation {
  session_id: string;
  trigger: string;
  success: number;
  memory_count: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

interface HealthData {
  available: boolean;
  stats: DistillationStats;
  recent: RecentDistillation[];
}

type SearchMode = 'semantic' | 'exact' | 'hybrid';

const SEARCH_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  data: Memory[];
  timestamp: number;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface MemoryCardProps {
  memory: Memory;
  onDelete: (hash: string) => void;
  deleting: boolean;
}

function MemoryCard({ memory, onDelete, deleting }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  const handleDelete = useCallback(() => {
    onDelete(memory.hash);
  }, [memory.hash, onDelete]);

  return (
    <div className={`memory-card ${expanded ? 'memory-card--expanded' : ''}`}>
      <div className="memory-card-header">
        <div className="memory-card-title">{memory.title}</div>
        <div className="memory-card-actions">
          <button
            className="memory-card-toggle"
            onClick={handleToggle}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▲' : '▼'}
          </button>
          <button
            className="memory-card-delete"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Delete memory"
            title="Delete memory"
          >
            {deleting ? '...' : '✕'}
          </button>
        </div>
      </div>

      <div className="memory-card-preview">
        {expanded ? memory.content || memory.preview : memory.preview}
        {!expanded && memory.content.length > 200 && (
          <span className="memory-card-truncate">...</span>
        )}
      </div>

      <div className="memory-card-footer">
        <div className="memory-card-tags">
          {memory.tags.map(tag => (
            <span key={tag} className="memory-tag">{tag}</span>
          ))}
        </div>
        <div className="memory-card-date">{formatDate(memory.created)}</div>
      </div>
    </div>
  );
}

interface HealthSectionProps {
  health: HealthData | null;
  loading: boolean;
}

function HealthSection({ health, loading }: HealthSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="memory-health">
        <div className="memory-health-header">
          <h3>Distillation Health</h3>
        </div>
        <div className="memory-skeleton" style={{ height: 80 }} />
      </div>
    );
  }

  if (!health) return null;

  return (
    <div className="memory-health">
      <div
        className="memory-health-header"
        onClick={() => setCollapsed(prev => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setCollapsed(prev => !prev)}
        aria-expanded={!collapsed}
      >
        <h3>Distillation Health</h3>
        <span className="memory-health-toggle">{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <>
          <div className="memory-health-stats">
            <div className="memory-stat-card">
              <div className="memory-stat-value">{health.stats.total}</div>
              <div className="memory-stat-label">Total Distillations</div>
            </div>
            <div className="memory-stat-card">
              <div className="memory-stat-value">{health.stats.successRate}%</div>
              <div className="memory-stat-label">Success Rate</div>
            </div>
            <div className="memory-stat-card">
              <div className="memory-stat-value">{formatDuration(health.stats.avgDurationMs)}</div>
              <div className="memory-stat-label">Avg Duration</div>
            </div>
            <div className="memory-stat-card">
              <div className={`memory-stat-value ${health.available ? 'memory-stat--ok' : 'memory-stat--warn'}`}>
                {health.available ? 'Online' : 'Offline'}
              </div>
              <div className="memory-stat-label">Server</div>
            </div>
          </div>

          {health.recent.length > 0 && (
            <div className="memory-health-table-wrap">
              <table className="memory-health-table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Trigger</th>
                    <th>Memories</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {health.recent.map((row, i) => (
                    <tr key={i}>
                      <td className="memory-table-session" title={row.session_id}>
                        {row.session_id.substring(0, 16)}…
                      </td>
                      <td>{row.trigger}</td>
                      <td>{row.memory_count}</td>
                      <td>{formatDuration(row.duration_ms)}</td>
                      <td>
                        <span className={`memory-badge ${row.success ? 'memory-badge--ok' : 'memory-badge--err'}`}>
                          {row.success ? 'ok' : 'fail'}
                        </span>
                      </td>
                      <td className="memory-table-date">{formatDate(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function MemoryDashboard() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('semantic');
  const [loadingMemories, setLoadingMemories] = useState(true);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingHashes, setDeletingHashes] = useState<Set<string>>(new Set());
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  const fetchMemories = useCallback(async (q: string, mode: SearchMode) => {
    const cacheKey = `${q}:${mode}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS) {
      setMemories(cached.data);
      return;
    }

    setLoadingMemories(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q,
        mode,
        limit: '20',
      });
      const resp = await fetch(`/api/memory/search?${params}`);
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error || 'Search failed');
      }
      const data: Memory[] = json.data ?? [];
      setMemories(data);
      cacheRef.current.set(cacheKey, { data, timestamp: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
      setMemories([]);
    } finally {
      setLoadingMemories(false);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const resp = await fetch('/api/memory/health');
      const json = await resp.json();
      if (!resp.ok || !json.success) {
        throw new Error(json.error || 'Health check failed');
      }
      setHealth(json.data);
    } catch {
      setHealth(null);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories('', 'semantic');
    fetchHealth();
  }, [fetchMemories, fetchHealth]);

  const handleSearch = useCallback(() => {
    fetchMemories(searchQuery, searchMode);
  }, [searchQuery, searchMode, fetchMemories]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }, [handleSearch]);

  const handleDelete = useCallback(async (hash: string) => {
    if (deletingHashes.has(hash)) return;

    setDeletingHashes(prev => new Set(Array.from(prev).concat(hash)));
    try {
      const resp = await fetch(`/api/memory/${encodeURIComponent(hash)}`, { method: 'DELETE' });
      const json = await resp.json();
      if (resp.ok && json.success) {
        setMemories(prev => prev.filter(m => m.hash !== hash));
        // Invalidate cache
        cacheRef.current.clear();
      } else {
        setError(json.error || 'Delete failed');
      }
    } catch {
      setError('Failed to delete memory');
    } finally {
      setDeletingHashes(prev => {
        const next = new Set(prev);
        next.delete(hash);
        return next;
      });
    }
  }, [deletingHashes]);

  return (
    <div className="memory-dashboard">
      <div className="memory-header">
        <div className="memory-title-row">
          <h1 className="memory-title">Memory</h1>
        </div>
        <div className="memory-search-row">
          <input
            type="text"
            className="memory-search-input"
            placeholder="Search memories…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <select
            className="memory-mode-select"
            value={searchMode}
            onChange={e => setSearchMode(e.target.value as SearchMode)}
            aria-label="Search mode"
          >
            <option value="semantic">Semantic</option>
            <option value="exact">Exact</option>
            <option value="hybrid">Hybrid</option>
          </select>
          <button className="memory-search-btn" onClick={handleSearch}>
            Search
          </button>
        </div>
      </div>

      {error && (
        <div className="memory-error" role="alert">
          {error}
          <button className="memory-error-dismiss" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="memory-content">
        {loadingMemories ? (
          <div className="memory-loading">
            {[1, 2, 3].map(i => (
              <div key={i} className="memory-skeleton-card">
                <div className="memory-skeleton memory-skeleton--title" />
                <div className="memory-skeleton memory-skeleton--text" />
                <div className="memory-skeleton memory-skeleton--text memory-skeleton--short" />
              </div>
            ))}
          </div>
        ) : memories.length === 0 ? (
          <div className="memory-empty">
            <div className="memory-empty-icon">◎</div>
            <p>No memories found{searchQuery ? ` for "${searchQuery}"` : ''}.</p>
          </div>
        ) : (
          <div className="memory-list">
            {memories.map(memory => (
              <MemoryCard
                key={memory.hash}
                memory={memory}
                onDelete={handleDelete}
                deleting={deletingHashes.has(memory.hash)}
              />
            ))}
          </div>
        )}

        <HealthSection health={health} loading={loadingHealth} />
      </div>
    </div>
  );
}
