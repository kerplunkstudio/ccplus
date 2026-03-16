import React, { useState, useEffect, useCallback } from 'react';
import './MCPPanel.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

interface McpStdioConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpHttpConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

type McpServerConfig = McpStdioConfig | McpHttpConfig;

interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  scope: 'user' | 'project';
  enabled: boolean;
}

interface MCPPanelProps {
  projectPath?: string;
}

type ServerType = 'stdio' | 'http';

interface AddFormState {
  name: string;
  type: ServerType;
  command: string;
  args: string;
  envPairs: Array<{ key: string; value: string }>;
  url: string;
  headerPairs: Array<{ key: string; value: string }>;
  scope: 'user' | 'project';
}

const INITIAL_FORM: AddFormState = {
  name: '',
  type: 'stdio',
  command: '',
  args: '',
  envPairs: [{ key: '', value: '' }],
  url: '',
  headerPairs: [{ key: '', value: '' }],
  scope: 'user',
};

const getServerType = (config: McpServerConfig): string => {
  if ('type' in config && config.type === 'http') return 'HTTP';
  return 'stdio';
};

const getServerCommand = (config: McpServerConfig): string => {
  if ('command' in config) {
    const args = config.args ? config.args.join(' ') : '';
    return `${config.command}${args ? ' ' + args : ''}`;
  }
  if ('url' in config) return config.url;
  return '';
};

export const MCPPanel: React.FC<MCPPanelProps> = ({ projectPath }) => {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState>(INITIAL_FORM);
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (projectPath) params.append('project', projectPath);
      const response = await fetch(`${SOCKET_URL}/api/mcp/servers?${params}`);
      if (response.ok) {
        const data = await response.json();
        setServers(data.servers);
        setError(null);
      } else {
        const text = await response.text();
        setError(`Failed to load servers: ${text}`);
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleToggleExpand = (name: string) => {
    setExpandedServer(prev => prev === name ? null : name);
  };

  const handleRemove = async (name: string, scope: string) => {
    setRemoving(name);
    try {
      const params = new URLSearchParams({ scope });
      if (projectPath) params.append('projectPath', projectPath);
      const response = await fetch(`${SOCKET_URL}/api/mcp/servers/${encodeURIComponent(name)}?${params}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        await fetchServers();
      }
    } catch {
      // Silently fail, user can retry
    } finally {
      setRemoving(null);
    }
  };

  const handleAddFormChange = (field: keyof AddFormState, value: unknown) => {
    setAddForm(prev => ({ ...prev, [field]: value }));
  };

  const handleEnvPairChange = (index: number, field: 'key' | 'value', value: string) => {
    setAddForm(prev => {
      const newPairs = prev.envPairs.map((pair, i) =>
        i === index ? { ...pair, [field]: value } : pair
      );
      // Auto-add empty row if last row has content
      const last = newPairs[newPairs.length - 1];
      if (last && (last.key || last.value)) {
        return { ...prev, envPairs: [...newPairs, { key: '', value: '' }] };
      }
      return { ...prev, envPairs: newPairs };
    });
  };

  const handleHeaderPairChange = (index: number, field: 'key' | 'value', value: string) => {
    setAddForm(prev => {
      const newPairs = prev.headerPairs.map((pair, i) =>
        i === index ? { ...pair, [field]: value } : pair
      );
      const last = newPairs[newPairs.length - 1];
      if (last && (last.key || last.value)) {
        return { ...prev, headerPairs: [...newPairs, { key: '', value: '' }] };
      }
      return { ...prev, headerPairs: newPairs };
    });
  };

  const handleAddSubmit = async () => {
    if (!addForm.name.trim()) return;

    let config: McpServerConfig;
    if (addForm.type === 'stdio') {
      if (!addForm.command.trim()) return;
      const env: Record<string, string> = {};
      for (const pair of addForm.envPairs) {
        if (pair.key.trim()) {
          env[pair.key.trim()] = pair.value;
        }
      }
      config = {
        command: addForm.command.trim(),
        ...(addForm.args.trim() ? { args: addForm.args.split(/\s+/).filter(Boolean) } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    } else {
      if (!addForm.url.trim()) return;
      const headers: Record<string, string> = {};
      for (const pair of addForm.headerPairs) {
        if (pair.key.trim()) {
          headers[pair.key.trim()] = pair.value;
        }
      }
      config = {
        type: 'http',
        url: addForm.url.trim(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
    }

    try {
      const response = await fetch(`${SOCKET_URL}/api/mcp/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name.trim(),
          config,
          scope: addForm.scope,
          projectPath: addForm.scope === 'project' ? projectPath : undefined,
        }),
      });
      if (response.ok) {
        setAddForm(INITIAL_FORM);
        setShowAddForm(false);
        await fetchServers();
      }
    } catch {
      // Silently fail
    }
  };

  const handleCancelAdd = () => {
    setAddForm(INITIAL_FORM);
    setShowAddForm(false);
  };

  if (loading) {
    return (
      <div className="mcp-panel">
        <div className="mcp-loading">Loading servers...</div>
      </div>
    );
  }

  return (
    <div className="mcp-panel">
      <div className="mcp-header">
        <h1 className="mcp-title">MCP Servers</h1>
        <button
          className={`mcp-add-btn ${showAddForm ? 'active' : ''}`}
          onClick={() => setShowAddForm(prev => !prev)}
        >
          {showAddForm ? '×' : '+'}
        </button>
      </div>

      <div className="mcp-subtitle">
        {servers.length} server{servers.length !== 1 ? 's' : ''} configured
      </div>

      {error && (
        <div className="mcp-error-bar">
          {error}
          <button className="mcp-error-retry" onClick={fetchServers}>Retry</button>
        </div>
      )}

      {/* Add Server Form */}
      {showAddForm && (
        <div className="mcp-add-form">
          <div className="mcp-form-section-label">NEW SERVER</div>

          <div className="mcp-form-row">
            <label className="mcp-form-label">Name</label>
            <input
              className="mcp-form-input"
              type="text"
              placeholder="my-server"
              value={addForm.name}
              onChange={e => handleAddFormChange('name', e.target.value)}
              autoFocus
            />
          </div>

          <div className="mcp-form-row">
            <label className="mcp-form-label">Type</label>
            <div className="mcp-type-toggle">
              <button
                className={`mcp-type-btn ${addForm.type === 'stdio' ? 'active' : ''}`}
                onClick={() => handleAddFormChange('type', 'stdio')}
              >
                stdio
              </button>
              <button
                className={`mcp-type-btn ${addForm.type === 'http' ? 'active' : ''}`}
                onClick={() => handleAddFormChange('type', 'http')}
              >
                http
              </button>
            </div>
          </div>

          <div className="mcp-form-row">
            <label className="mcp-form-label">Scope</label>
            <div className="mcp-type-toggle">
              <button
                className={`mcp-type-btn ${addForm.scope === 'user' ? 'active' : ''}`}
                onClick={() => handleAddFormChange('scope', 'user')}
              >
                user
              </button>
              <button
                className={`mcp-type-btn ${addForm.scope === 'project' ? 'active' : ''}`}
                onClick={() => handleAddFormChange('scope', 'project')}
                disabled={!projectPath}
                title={!projectPath ? 'Open a project first' : undefined}
              >
                project
              </button>
            </div>
          </div>

          {addForm.type === 'stdio' ? (
            <>
              <div className="mcp-form-row">
                <label className="mcp-form-label">Command</label>
                <input
                  className="mcp-form-input mcp-form-input--mono"
                  type="text"
                  placeholder="npx -y @modelcontextprotocol/server-github"
                  value={addForm.command}
                  onChange={e => handleAddFormChange('command', e.target.value)}
                />
              </div>
              <div className="mcp-form-row">
                <label className="mcp-form-label">Args</label>
                <input
                  className="mcp-form-input mcp-form-input--mono"
                  type="text"
                  placeholder="--flag value (space-separated)"
                  value={addForm.args}
                  onChange={e => handleAddFormChange('args', e.target.value)}
                />
              </div>
              <div className="mcp-form-row mcp-form-row--top">
                <label className="mcp-form-label">Env</label>
                <div className="mcp-kv-list">
                  {addForm.envPairs.map((pair, i) => (
                    <div key={i} className="mcp-kv-row">
                      <input
                        className="mcp-form-input mcp-form-input--mono mcp-kv-key"
                        placeholder="KEY"
                        value={pair.key}
                        onChange={e => handleEnvPairChange(i, 'key', e.target.value)}
                      />
                      <span className="mcp-kv-eq">=</span>
                      <input
                        className="mcp-form-input mcp-form-input--mono mcp-kv-value"
                        placeholder="value"
                        value={pair.value}
                        onChange={e => handleEnvPairChange(i, 'value', e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mcp-form-row">
                <label className="mcp-form-label">URL</label>
                <input
                  className="mcp-form-input mcp-form-input--mono"
                  type="text"
                  placeholder="https://api.example.com/mcp"
                  value={addForm.url}
                  onChange={e => handleAddFormChange('url', e.target.value)}
                />
              </div>
              <div className="mcp-form-row mcp-form-row--top">
                <label className="mcp-form-label">Headers</label>
                <div className="mcp-kv-list">
                  {addForm.headerPairs.map((pair, i) => (
                    <div key={i} className="mcp-kv-row">
                      <input
                        className="mcp-form-input mcp-form-input--mono mcp-kv-key"
                        placeholder="Header-Name"
                        value={pair.key}
                        onChange={e => handleHeaderPairChange(i, 'key', e.target.value)}
                      />
                      <span className="mcp-kv-eq">:</span>
                      <input
                        className="mcp-form-input mcp-form-input--mono mcp-kv-value"
                        placeholder="value"
                        value={pair.value}
                        onChange={e => handleHeaderPairChange(i, 'value', e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="mcp-form-actions">
            <button className="mcp-form-cancel" onClick={handleCancelAdd}>Cancel</button>
            <button
              className="mcp-form-submit"
              onClick={handleAddSubmit}
              disabled={!addForm.name.trim() || (addForm.type === 'stdio' ? !addForm.command.trim() : !addForm.url.trim())}
            >
              Add Server
            </button>
          </div>
        </div>
      )}

      {/* Server List */}
      {servers.length === 0 && !showAddForm ? (
        <div className="mcp-empty">
          <div className="mcp-empty-text">No MCP servers configured</div>
          <div className="mcp-empty-hint">
            Add servers to extend Claude's capabilities with external tools
          </div>
          <button className="mcp-empty-cta" onClick={() => setShowAddForm(true)}>
            + Add your first server
          </button>
        </div>
      ) : (
        <div className="mcp-server-list">
          {servers.map(server => {
            const isExpanded = expandedServer === server.name;
            const serverType = getServerType(server.config);
            const serverCmd = getServerCommand(server.config);

            return (
              <div
                key={`${server.name}-${server.scope}`}
                className={`mcp-server ${isExpanded ? 'expanded' : ''}`}
              >
                <div
                  className="mcp-server-row"
                  onClick={() => handleToggleExpand(server.name)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleToggleExpand(server.name);
                    }
                  }}
                >
                  <span className="mcp-server-status" />
                  <span className="mcp-server-name">{server.name}</span>
                  <span className="mcp-server-type">{serverType}</span>
                  <span className="mcp-server-scope">{server.scope}</span>
                  <span className={`mcp-server-chevron ${isExpanded ? 'expanded' : ''}`}>▸</span>
                </div>

                {isExpanded && (
                  <div className="mcp-server-detail">
                    <div className="mcp-detail-row">
                      <span className="mcp-detail-label">
                        {serverType === 'stdio' ? 'Command' : 'URL'}
                      </span>
                      <code className="mcp-detail-value">{serverCmd}</code>
                    </div>

                    {'env' in server.config && server.config.env && Object.keys(server.config.env).length > 0 && (
                      <div className="mcp-detail-row">
                        <span className="mcp-detail-label">Env</span>
                        <div className="mcp-detail-env">
                          {Object.entries(server.config.env).map(([key, val]) => (
                            <div key={key} className="mcp-env-entry">
                              <span className="mcp-env-key">{key}</span>
                              <span className="mcp-env-eq">=</span>
                              <span className="mcp-env-val">{val.length > 20 ? val.substring(0, 20) + '...' : val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {'headers' in server.config && server.config.headers && Object.keys(server.config.headers).length > 0 && (
                      <div className="mcp-detail-row">
                        <span className="mcp-detail-label">Headers</span>
                        <div className="mcp-detail-env">
                          {Object.entries(server.config.headers).map(([key, val]) => (
                            <div key={key} className="mcp-env-entry">
                              <span className="mcp-env-key">{key}</span>
                              <span className="mcp-env-eq">:</span>
                              <span className="mcp-env-val">{val.length > 20 ? val.substring(0, 20) + '...' : val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mcp-detail-actions">
                      <button
                        className="mcp-remove-btn"
                        onClick={() => handleRemove(server.name, server.scope)}
                        disabled={removing === server.name}
                      >
                        {removing === server.name ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
