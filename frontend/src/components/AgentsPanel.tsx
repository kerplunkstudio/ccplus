import React, { useState } from 'react';
import { useAgents } from '../hooks/useAgents';
import type { Agent } from '../hooks/useAgents';
import './AgentsPanel.css';

export const AgentsPanel: React.FC = () => {
  const { agents, loading, error } = useAgents();
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const handleToggleExpand = (id: string) => {
    setExpandedAgent(prev => prev === id ? null : id);
  };

  if (loading) {
    return (
      <div className="agents-panel">
        <div className="agents-container">
          <div className="agents-loading">Loading agents...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="agents-panel">
        <div className="agents-container">
          <div className="agents-error">{error}</div>
        </div>
      </div>
    );
  }

  const formatYaml = (agent: Agent): string => {
    const lines: string[] = [];

    lines.push(`id: ${agent.id}`);
    lines.push(`name: ${agent.name}`);

    if (agent.description) {
      lines.push(`description: ${agent.description}`);
    }

    if (agent.model) {
      lines.push(`model: ${agent.model}`);
    }

    if (agent.maxTurns) {
      lines.push(`maxTurns: ${agent.maxTurns}`);
    }

    if (agent.personality) {
      lines.push(`personality: "${agent.personality}"`);
    }

    if (agent.security) {
      lines.push('security:');
      if (agent.security.allowedTools && agent.security.allowedTools.length > 0) {
        lines.push(`  allowedTools:`);
        agent.security.allowedTools.forEach(tool => {
          lines.push(`    - ${tool}`);
        });
      }
      if (agent.security.disallowedTools && agent.security.disallowedTools.length > 0) {
        lines.push(`  disallowedTools:`);
        agent.security.disallowedTools.forEach(tool => {
          lines.push(`    - ${tool}`);
        });
      }
    }

    lines.push(`dirPath: ${agent.dirPath}`);

    return lines.join('\n');
  };

  return (
    <div className="agents-panel">
      <div className="agents-container">
        <div className="agents-header">
          <h1 className="agents-title">Agents</h1>
          <button
            className="agents-new-btn"
            disabled
            title="Coming soon: Create new agents from the UI"
          >
            + New Agent
          </button>
        </div>

        <div className="agents-subtitle">
          {agents.length} agent{agents.length !== 1 ? 's' : ''} configured
        </div>

        {agents.length === 0 ? (
          <div className="agents-empty">
            <div className="agents-empty-text">No agents configured</div>
            <div className="agents-empty-hint">
              Create <code>.ccplus/agents/&lt;name&gt;/agent.yaml</code> to get started
            </div>
          </div>
        ) : (
          <div className="agents-list">
            {agents.map(agent => {
              const isExpanded = expandedAgent === agent.id;
              const hasSecurityPolicy = agent.security && (
                (agent.security.allowedTools && agent.security.allowedTools.length > 0) ||
                (agent.security.disallowedTools && agent.security.disallowedTools.length > 0)
              );

              return (
                <div
                  key={agent.id}
                  className={`agent-card ${isExpanded ? 'expanded' : ''}`}
                >
                  <div
                    className="agent-card-header"
                    onClick={() => handleToggleExpand(agent.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggleExpand(agent.id);
                      }
                    }}
                  >
                    <div className="agent-card-title-row">
                      <span className="agent-card-name">{agent.name}</span>
                      <div className="agent-card-badges">
                        {agent.model && (
                          <span className="agent-badge agent-badge-model">
                            {agent.model}
                          </span>
                        )}
                        {hasSecurityPolicy && (
                          <span className="agent-badge agent-badge-security" title="Has security policy">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                              <path
                                d="M8 2L3 4v4c0 3 2 5 5 6 3-1 5-3 5-6V4l-5-2z"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                fill="none"
                              />
                            </svg>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="agent-card-description">{agent.description}</div>
                    <span className={`agent-chevron ${isExpanded ? 'expanded' : ''}`}>▸</span>
                  </div>

                  {isExpanded && (
                    <div className="agent-card-detail">
                      <div className="agent-detail-section">
                        <div className="agent-detail-label">Configuration</div>
                        <pre className="agent-detail-yaml">
                          <code>{formatYaml(agent)}</code>
                        </pre>
                      </div>

                      {agent.soulContent && (
                        <div className="agent-detail-section">
                          <div className="agent-detail-label">Full Definition</div>
                          <pre className="agent-detail-soul">
                            <code>{agent.soulContent}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
