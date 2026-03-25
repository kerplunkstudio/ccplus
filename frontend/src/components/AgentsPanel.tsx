import React, { useState, useCallback } from 'react';
import { useAgents } from '../hooks/useAgents';
import type { Agent } from '../hooks/useAgents';
import { AGENT_ICONS } from '../constants/agentIcons';
import { SOCKET_URL } from '../config';
import './AgentsPanel.css';

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
