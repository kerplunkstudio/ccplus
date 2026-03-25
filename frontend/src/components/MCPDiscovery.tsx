import React, { useState, useEffect } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { SOCKET_URL } from '../config';
import './MCPDiscovery.css';

const isSafeUrl = (url: string): boolean =>
  url.startsWith('https://') || url.startsWith('http://');

interface PulseMcpServer {
  name: string;
  short_description: string;
  source_code_url: string | null;
  package_registry: string | null;
  package_name: string | null;
  package_download_count: number | null;
  github_stars: number | null;
  EXPERIMENTAL_ai_generated_description: string | null;
}

interface DiscoveryResult {
  servers: PulseMcpServer[];
  total_count: number;
  offset: number;
  has_more: boolean;
}

interface MCPDiscoveryProps {
  projectPath?: string;
  onInstallSuccess: () => void;
}

type InstallState = 'idle' | 'installing' | 'installed' | 'error';

export const MCPDiscovery: React.FC<MCPDiscoveryProps> = ({ projectPath, onInstallSuccess }) => {
  const [query, setQuery] = useState('');
  const [servers, setServers] = useState<PulseMcpServer[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Map<string, InstallState>>(new Map());

  const debouncedQuery = useDebounce(query, 400);

  const fetchServers = async (searchQuery: string, currentOffset: number, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('query', searchQuery);
      params.append('offset', currentOffset.toString());

      const response = await fetch(`${SOCKET_URL}/api/mcp/discover?${params}`);
      if (response.ok) {
        const data: DiscoveryResult = await response.json();
        setServers(prev => append ? [...prev, ...data.servers] : data.servers);
        setTotalCount(data.total_count);
        setHasMore(data.has_more);
      } else {
        const text = await response.text();
        setError(`Failed to load servers: ${text}`);
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchServers(debouncedQuery, 0, false);
  }, [debouncedQuery]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchServers(debouncedQuery, servers.length, true);
    }
  };

  const canInstall = (server: PulseMcpServer): boolean => {
    return server.package_registry === 'npm' || server.package_registry === 'pypi';
  };

  const handleInstall = async (server: PulseMcpServer) => {
    if (!canInstall(server)) return;

    const currentState = installing.get(server.name) || 'idle';
    if (currentState === 'installing') return;

    setInstalling(prev => {
      const next = new Map(prev);
      next.set(server.name, 'installing');
      return next;
    });

    try {
      const response = await fetch(`${SOCKET_URL}/api/mcp/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: server.name,
          packageRegistry: server.package_registry,
          packageName: server.package_name,
          sourceUrl: server.source_code_url,
          scope: 'user',
        }),
      });

      if (response.ok) {
        setInstalling(prev => {
          const next = new Map(prev);
          next.set(server.name, 'installed');
          return next;
        });
        onInstallSuccess();
      } else {
        setInstalling(prev => {
          const next = new Map(prev);
          next.set(server.name, 'error');
          return next;
        });
      }
    } catch {
      setInstalling(prev => {
        const next = new Map(prev);
        next.set(server.name, 'error');
        return next;
      });
    }
  };

  const getInstallButtonText = (state: InstallState): string => {
    switch (state) {
      case 'installing': return 'Installing...';
      case 'installed': return 'Installed ✓';
      case 'error': return 'Retry';
      default: return 'Install';
    }
  };

  const getInstallButtonClass = (state: InstallState): string => {
    let classes = 'mcp-discovery-install-btn';
    if (state === 'installed') classes += ' mcp-discovery-install-btn--installed';
    if (state === 'error') classes += ' mcp-discovery-install-btn--error';
    return classes;
  };

  if (loading) {
    return (
      <div className="mcp-discovery">
        <div className="mcp-discovery-spinner">Loading servers...</div>
      </div>
    );
  }

  return (
    <div className="mcp-discovery">
      <input
        className="mcp-discovery-search"
        type="text"
        placeholder="Search 12,000+ MCP servers..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus
      />

      {error && (
        <div className="mcp-discovery-error">
          <span>{error}</span>
          <button className="mcp-error-retry" onClick={() => fetchServers(debouncedQuery, 0, false)}>
            Retry
          </button>
        </div>
      )}

      <div className="mcp-discovery-count">{totalCount.toLocaleString()} servers found</div>

      <div className="mcp-discovery-list">
        {servers.map(server => {
          const installState = installing.get(server.name) || 'idle';
          const description = server.short_description || server.EXPERIMENTAL_ai_generated_description || '';

          return (
            <div key={server.name} className="mcp-discovery-card">
              <div className="mcp-discovery-card-header">
                <span className="mcp-discovery-card-name">{server.name}</span>
                <div className="mcp-discovery-card-badges">
                  {server.package_registry && (
                    <span className="mcp-discovery-badge mcp-discovery-badge--registry">
                      {server.package_registry}
                    </span>
                  )}
                  {server.github_stars !== null && server.github_stars > 0 && (
                    <span className="mcp-discovery-badge mcp-discovery-badge--stars">
                      ★ {server.github_stars}
                    </span>
                  )}
                </div>
              </div>

              {description && <div className="mcp-discovery-card-desc">{description}</div>}

              <div className="mcp-discovery-card-footer">
                {server.source_code_url && isSafeUrl(server.source_code_url) && (
                  <a
                    href={server.source_code_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mcp-discovery-source-link"
                  >
                    Source ↗
                  </a>
                )}
                {canInstall(server) ? (
                  <button
                    className={getInstallButtonClass(installState)}
                    onClick={() => handleInstall(server)}
                    disabled={installState === 'installing' || installState === 'installed'}
                  >
                    {getInstallButtonText(installState)}
                  </button>
                ) : (
                  server.source_code_url && <span className="mcp-discovery-manual">Manual setup</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          className="mcp-discovery-load-more"
          onClick={handleLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
};
