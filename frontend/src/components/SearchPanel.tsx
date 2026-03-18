import React, { useState, useRef, useEffect } from 'react';
import { useSearch } from '../hooks/useSearch';
import './SearchPanel.css';

interface SearchPanelProps {
  onNavigateToSession?: (sessionId: string) => void;
  onClose?: () => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({ onNavigateToSession, onClose }) => {
  const [query, setQuery] = useState<string>('');
  const { results, loading, error } = useSearch(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleResultClick = (sessionId: string) => {
    if (onNavigateToSession) {
      onNavigateToSession(sessionId);
    }
    if (onClose) {
      onClose();
    }
  };

  const highlightMatch = (text: string, searchQuery: string): React.ReactElement => {
    if (!searchQuery.trim()) {
      return <>{text}</>;
    }

    const lowerText = text.toLowerCase();
    const lowerQuery = searchQuery.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) {
      const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
      return <>{truncated}</>;
    }

    const contextStart = Math.max(0, index - 50);
    const contextEnd = Math.min(text.length, index + searchQuery.length + 150);
    const snippet = text.slice(contextStart, contextEnd);
    const prefix = contextStart > 0 ? '...' : '';
    const suffix = contextEnd < text.length ? '...' : '';

    const matchStart = index - contextStart;
    const matchEnd = matchStart + searchQuery.length;

    return (
      <>
        {prefix}
        {snippet.slice(0, matchStart)}
        <mark className="search-highlight">{snippet.slice(matchStart, matchEnd)}</mark>
        {snippet.slice(matchEnd)}
        {suffix}
      </>
    );
  };

  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.session_id]) {
      acc[result.session_id] = [];
    }
    acc[result.session_id].push(result);
    return acc;
  }, {} as Record<string, typeof results>);

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search conversations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {onClose && (
          <button className="search-close-button" onClick={onClose} aria-label="Close search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="search-results">
        {loading && (
          <div className="search-status">
            <div className="search-spinner" />
            <span>Searching...</span>
          </div>
        )}

        {error && (
          <div className="search-status search-error">
            <span>Error: {error}</span>
          </div>
        )}

        {!loading && !error && query.trim() && results.length === 0 && (
          <div className="search-status search-empty">
            <span>No results found</span>
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <div className="search-results-list">
            {Object.entries(groupedResults).map(([sessionId, sessionResults]) => {
              const firstUserMessage = sessionResults.find((r) => r.role === 'user');
              const sessionLabel = firstUserMessage
                ? firstUserMessage.content.slice(0, 60) + (firstUserMessage.content.length > 60 ? '...' : '')
                : sessionId;

              return (
                <div key={sessionId} className="search-result-group">
                  <div
                    className="search-result-session"
                    onClick={() => handleResultClick(sessionId)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleResultClick(sessionId)}
                  >
                    <div className="search-result-session-label">{sessionLabel}</div>
                    <div className="search-result-session-id">{sessionId}</div>
                  </div>
                  {sessionResults.slice(0, 3).map((result, idx) => (
                    <div
                      key={`${result.session_id}-${idx}`}
                      className="search-result-item"
                      onClick={() => handleResultClick(result.session_id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleResultClick(result.session_id)}
                    >
                      <div className="search-result-role">{result.role}</div>
                      <div className="search-result-content">
                        {highlightMatch(result.content, query)}
                      </div>
                      <div className="search-result-timestamp">
                        {new Date(result.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
