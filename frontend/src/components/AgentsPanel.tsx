import React, { useState, useCallback } from 'react';
import { useAgents } from '../hooks/useAgents';
import type { Agent } from '../hooks/useAgents';
import './AgentsPanel.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

const AGENT_ICONS: Record<string, { label: string; path: string }> = {
  'bot': { label: 'Bot', path: 'M12 2a2 2 0 012 2v1h2a3 3 0 013 3v8a3 3 0 01-3 3H8a3 3 0 01-3-3V8a3 3 0 013-3h2V4a2 2 0 012-2zm-3 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z' },
  'brain': { label: 'Brain', path: 'M12 2C9 2 7 4 7 6.5c0 1-.5 2-1.5 2.5C4 10 3 11.5 3 13.5 3 16 5 18 7.5 18H8v2a2 2 0 004 0v-2h.5c2.5 0 4.5-2 4.5-4.5 0-2-1-3.5-2.5-4.5-1-.5-1.5-1.5-1.5-2.5C13 4 11 2 12 2z' },
  'shield': { label: 'Shield', path: 'M12 2L4 5v4.5c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3z' },
  'wrench': { label: 'Wrench', path: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l2.6-2.6c.5 1.2.3 2.6-.6 3.5a3.5 3.5 0 01-4.2.5L8.7 17.5a2 2 0 01-2.8 0l-.4-.4a2 2 0 010-2.8l6.8-6.8a3.5 3.5 0 01.5-4.2 3.5 3.5 0 013.5-.6L14.7 5.3z' },
  'eye': { label: 'Eye', path: 'M12 5C7 5 3 9 2 12c1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 10a3 3 0 110-6 3 3 0 010 6z' },
  'lightning': { label: 'Lightning', path: 'M13 2L4.5 12.5h5l-1 9.5 8.5-10.5h-5L13 2z' },
  'code': { label: 'Code', path: 'M8 5l-5 7 5 7M16 5l5 7-5 7M14 3l-4 18' },
  'search': { label: 'Search', path: 'M10 3a7 7 0 104.9 12l4.6 4.5a1 1 0 001.4-1.4L16.4 13A7 7 0 0010 3zm0 2a5 5 0 110 10 5 5 0 010-10z' },
  'book': { label: 'Book', path: 'M4 4.5A2.5 2.5 0 016.5 2H20v16H6.5A2.5 2.5 0 014 15.5v-11zM6.5 18H20v2H6.5a.5.5 0 010-1H20v-1H6.5z' },
  'compass': { label: 'Compass', path: 'M12 2a10 10 0 100 20 10 10 0 000-20zm3.5 6.5l-2 5-5 2 2-5 5-2z' },
  'target': { label: 'Target', path: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 110 12 6 6 0 010-12zm0 4a2 2 0 100 4 2 2 0 000-4z' },
  'puzzle': { label: 'Puzzle', path: 'M20 8h-2.8a2 2 0 01-3.4-1.4V4a2 2 0 00-2-2h-1.6a2 2 0 00-2 2v2.6A2 2 0 014.8 8H4a2 2 0 00-2 2v1.6c0 1.1.9 2 2 2h2.6a2 2 0 013.4 1.4v2.8c0 1.1.9 2 2 2h1.6a2 2 0 002-2V15a2 2 0 013.4-1.4H20a2 2 0 002-2v-1.6a2 2 0 00-2-2z' },
  'flask': { label: 'Flask', path: 'M9 2v6.5L4 17a2 2 0 001.7 3h12.6a2 2 0 001.7-3L15 8.5V2M8 2h8M7 15h10' },
  'document': { label: 'Document', path: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1v5h5M8 13h8M8 17h8M8 9h2' },
  'chat': { label: 'Chat', path: 'M21 12a9 9 0 01-9 9c-1.7 0-3.3-.5-4.7-1.3L3 21l1.3-4.3A9 9 0 0112 3a9 9 0 019 9z' },
  'globe': { label: 'Globe', path: 'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a14 14 0 014 10 14 14 0 01-4 10 14 14 0 01-4-10A14 14 0 0112 2z' },
  'layers': { label: 'Layers', path: 'M12 2L2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5' },
  'star': { label: 'Star', path: 'M12 2l3 6.2 6.8 1-5 4.8 1.2 6.8L12 17.8 6 20.8l1.2-6.8-5-4.8 6.8-1L12 2z' },
  'lock': { label: 'Lock', path: 'M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 116 0v3H9z' },
  'cpu': { label: 'CPU', path: 'M6 4h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2zm3 5h6v6H9V9zm-5 2h2M17 11h2M11 2v2M11 20v2M15 2v2M15 20v2M2 15h2M20 15h2' },
};

const MODEL_OPTIONS = ['sonnet', 'opus', 'haiku'] as const;

const BLOCKABLE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent', 'WebSearch', 'WebFetch', 'NotebookEdit'] as const;

interface EditState {
  icon?: string;
  model?: string;
  personality?: string;
  disallowedTools?: string[];
}

export const AgentsPanel: React.FC = () => {
  const { agents, loading, error, refetch } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [editState, setEditState] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState(false);

  const handleSelect = useCallback((id: string) => {
    setSelectedAgent((prev) => (prev === id ? null : id));
  }, []);

  const handleEdit = useCallback((id: string, field: keyof EditState, value: any) => {
    setEditState((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }, []);

  const handleToggleTool = useCallback((agentId: string, currentTools: string[] = [], tool: string) => {
    const updatedTools = currentTools.includes(tool)
      ? currentTools.filter((t) => t !== tool)
      : [...currentTools, tool];
    handleEdit(agentId, 'disallowedTools', updatedTools);
  }, [handleEdit]);

  const handleSave = useCallback(async (agent: Agent) => {
    setSaving(true);
    const edits = editState[agent.id] || {};

    const config = {
      name: agent.name,
      description: agent.description,
      model: edits.model ?? agent.model,
      icon: edits.icon ?? agent.icon,
      maxTurns: agent.maxTurns,
      personality: edits.personality ?? agent.personality,
      security: {
        allowedTools: agent.security?.allowedTools,
        disallowedTools: edits.disallowedTools ?? agent.security?.disallowedTools,
      },
    };

    try {
      const response = await fetch(`${SOCKET_URL}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, config }),
      });

      if (!response.ok) {
        throw new Error('Failed to save agent');
      }

      setEditState((prev) => {
        const next = { ...prev };
        delete next[agent.id];
        return next;
      });

      await refetch();
    } catch (err) {
      // Error handling could be improved with user notification
    } finally {
      setSaving(false);
    }
  }, [editState, refetch]);

  const hasUnsavedChanges = useCallback((agentId: string): boolean => {
    return Boolean(editState[agentId]);
  }, [editState]);

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

  return (
    <div className="agents-panel">
      <div className="agents-container">
        <div className="agents-header">
          <div className="agents-header-content">
            <h1 className="agents-title">Agents</h1>
            <div className="agents-count">
              {agents.length} agent{agents.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="agents-empty">
            <div className="agents-empty-monogram">?</div>
            <div className="agents-empty-text">No agents configured</div>
            <div className="agents-empty-hint">
              Create agent.yaml in .ccplus/agents/ to get started
            </div>
          </div>
        ) : (
          <div className="agents-grid">
            {agents.map((agent, index) => {
              const isSelected = selectedAgent === agent.id;
              const iconName = agent.icon || 'bot';
              const icon = AGENT_ICONS[iconName] || AGENT_ICONS['bot'];
              const currentModel = editState[agent.id]?.model ?? agent.model ?? 'sonnet';
              const currentPersonality = editState[agent.id]?.personality ?? agent.personality ?? '';
              const currentDisallowedTools = editState[agent.id]?.disallowedTools ?? agent.security?.disallowedTools ?? [];

              return (
                <React.Fragment key={agent.id}>
                  <div
                    className={`agent-tile ${isSelected ? 'agent-tile-selected' : ''}`}
                    onClick={() => handleSelect(agent.id)}
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className="agent-tile-icon">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d={icon.path} />
                      </svg>
                    </div>
                    <div className="agent-tile-name">{agent.name}</div>
                    <div className={`agent-tile-model agent-tile-model-${currentModel}`}>
                      {currentModel}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="agent-edit-panel">
                      <div className="agent-edit-content">
                        <div className="agent-edit-left">
                          <div className="agent-edit-label">Icon</div>
                          <div className="agent-icon-picker">
                            {Object.entries(AGENT_ICONS).map(([key, iconData]) => (
                              <button
                                key={key}
                                className={`agent-icon-option ${(editState[agent.id]?.icon ?? agent.icon ?? 'bot') === key ? 'agent-icon-option-active' : ''}`}
                                onClick={() => handleEdit(agent.id, 'icon', key)}
                                title={iconData.label}
                                type="button"
                              >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d={iconData.path} />
                                </svg>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="agent-edit-right">
                          <div className="agent-edit-field">
                            <div className="agent-edit-label">Model</div>
                            <div className="agent-model-selector">
                              {MODEL_OPTIONS.map((model) => (
                                <button
                                  key={model}
                                  className={`agent-model-pill ${currentModel === model ? 'agent-model-pill-active' : ''}`}
                                  onClick={() => handleEdit(agent.id, 'model', model)}
                                  type="button"
                                >
                                  {model}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="agent-edit-field">
                            <div className="agent-edit-label">Personality</div>
                            <textarea
                              className="agent-edit-textarea"
                              value={currentPersonality}
                              onChange={(e) => handleEdit(agent.id, 'personality', e.target.value)}
                              placeholder="How should this agent behave?"
                              rows={3}
                                />
                          </div>

                          <div className="agent-edit-field">
                            <div className="agent-edit-label">Blocked tools</div>
                            <div className="agent-tool-tags">
                              {BLOCKABLE_TOOLS.map((tool) => {
                                const isBlocked = currentDisallowedTools.includes(tool);
                                return (
                                  <button
                                    key={tool}
                                    className={`agent-tool-toggle ${isBlocked ? 'agent-tool-toggle-active' : ''}`}
                                    onClick={() => handleToggleTool(agent.id, currentDisallowedTools, tool)}
                                    type="button"
                                  >
                                    {tool}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {hasUnsavedChanges(agent.id) && (
                            <button
                              className="agent-save-button"
                              onClick={() => handleSave(agent)}
                              disabled={saving}
                              type="button"
                            >
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
