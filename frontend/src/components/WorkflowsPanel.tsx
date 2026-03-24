import React, { useState } from 'react';
import { useWorkflows, WorkflowConfig, WorkflowPhaseConfig, ToolRule, WorkflowTransition } from '../hooks/useWorkflows';
import './WorkflowsPanel.css';

function toYamlString(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (obj === null || obj === undefined) {
    return 'null';
  }

  if (typeof obj === 'string') {
    return obj.includes('\n') || obj.includes(':') || obj.includes('#')
      ? `|\n${spaces}  ${obj.split('\n').join(`\n${spaces}  `)}`
      : obj;
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => `\n${spaces}- ${toYamlString(item, indent + 1).replace(/^\n\s*/, '')}`).join('');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, value]) => {
        const valStr = toYamlString(value, indent + 1);
        const needsNewline = valStr.startsWith('\n');
        return `\n${spaces}${key}:${needsNewline ? '' : ' '}${valStr}`;
      })
      .join('');
  }

  return String(obj);
}

interface MiniPipelineProps {
  phases: WorkflowPhaseConfig[];
}

function MiniPipeline({ phases }: MiniPipelineProps) {
  const filtered = phases.filter(p => p.name.toLowerCase() !== 'idle');
  if (filtered.length === 0) return null;

  const showAll = filtered.length <= 6;
  const displayPhases = showAll
    ? filtered
    : [...filtered.slice(0, 4), filtered[filtered.length - 1]];

  return (
    <div className="wf-mini-pipeline">
      {displayPhases.map((phase, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && (
            !showAll && idx === 4
              ? <span className="wf-mini-ellipsis">...</span>
              : <span className="wf-mini-sep">→</span>
          )}
          <div className="wf-mini-phase">
            <span className="wf-mini-phase-name">{phase.name}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

interface PhaseNodeProps {
  phase: WorkflowPhaseConfig;
  selected: boolean;
  onClick: () => void;
}

function PhaseNode({ phase, selected, onClick }: PhaseNodeProps) {
  const agentHints = phase.agentHints || [];
  const ruleCount = phase.toolRules?.length || 0;

  return (
    <div
      className={`wf-phase-node ${selected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="wf-phase-node-name">{phase.name}</div>
      <div className="wf-phase-node-meta">
        {agentHints.length > 0 && (
          <div className="wf-phase-agent-badges">
            {agentHints.slice(0, 3).map(name => (
              <span key={name} className="wf-phase-agent-badge" title={name}>
                {name.charAt(0).toUpperCase()}
              </span>
            ))}
            {agentHints.length > 3 && (
              <span className="wf-phase-agent-badge wf-phase-agent-more" title={agentHints.slice(3).join(', ')}>
                +{agentHints.length - 3}
              </span>
            )}
          </div>
        )}
        {ruleCount > 0 && <span>{ruleCount} rule{ruleCount !== 1 ? 's' : ''}</span>}
      </div>
    </div>
  );
}

interface PhaseEditorProps {
  phase: WorkflowPhaseConfig;
  agents: Array<{ name: string; description: string; icon?: string }>;
  onUpdate: (updates: Partial<WorkflowPhaseConfig>) => void;
  onRemove: () => void;
}

function PhaseEditor({ phase, agents, onUpdate, onRemove }: PhaseEditorProps) {
  const selectedAgents = phase.agentHints || [];
  const rules = phase.toolRules || [];

  const toggleAgent = (agentName: string) => {
    const newAgents = selectedAgents.includes(agentName)
      ? selectedAgents.filter(a => a !== agentName)
      : [...selectedAgents, agentName];
    onUpdate({ agentHints: newAgents });
  };

  const addRule = () => {
    const newRules = [...rules, { tool: '', action: 'warn' as const, condition: '', message: '' }];
    onUpdate({ toolRules: newRules });
  };

  const updateRule = (idx: number, updates: Partial<ToolRule>) => {
    const newRules = rules.map((r, i) => (i === idx ? { ...r, ...updates } : r));
    onUpdate({ toolRules: newRules });
  };

  const removeRule = (idx: number) => {
    const newRules = rules.filter((_, i) => i !== idx);
    onUpdate({ toolRules: newRules });
  };

  return (
    <div className="wf-phase-editor">
      <div className="wf-editor-section">
        <label className="wf-editor-label">Phase Name</label>
        <input
          className="wf-editor-input"
          type="text"
          value={phase.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Phase name"
        />
      </div>

      <div className="wf-editor-section">
        <label className="wf-editor-label">Context</label>
        <textarea
          className="wf-editor-textarea"
          value={phase.context || ''}
          onChange={(e) => onUpdate({ context: e.target.value })}
          placeholder="Optional context for this phase"
          rows={3}
        />
      </div>

      <div className="wf-editor-section">
        <label className="wf-editor-label">
          Agent Hints
          {selectedAgents.length > 0 && (
            <span className="wf-agent-count"> — {selectedAgents.length} selected</span>
          )}
        </label>
        <div className="wf-agent-picker">
          {agents.length === 0 ? (
            <div className="wf-agent-empty">No agents configured</div>
          ) : (
            agents.map((agent) => {
              const isSelected = selectedAgents.includes(agent.name);
              const avatar = agent.icon || agent.name.charAt(0).toUpperCase();
              return (
                <div
                  key={agent.name}
                  className={`wf-agent-chip ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleAgent(agent.name)}
                  role="button"
                  tabIndex={0}
                  title={agent.description}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleAgent(agent.name);
                    }
                  }}
                >
                  <span className="wf-agent-avatar">{avatar}</span>
                  {agent.name}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="wf-editor-section">
        <div className="wf-editor-section-header">
          <label className="wf-editor-label">Tool Rules</label>
          <button className="wf-add-link" onClick={addRule}>+ add rule</button>
        </div>
        {rules.length > 0 && (
          <div className="wf-rules-list">
            {rules.map((rule, idx) => (
              <div key={idx} className="wf-rule-row">
                <input
                  className="wf-rule-input wf-rule-tool"
                  type="text"
                  value={rule.tool}
                  onChange={(e) => updateRule(idx, { tool: e.target.value })}
                  placeholder="tool name"
                />
                <select
                  className="wf-rule-select"
                  value={rule.action}
                  onChange={(e) => updateRule(idx, { action: e.target.value as 'allow' | 'warn' | 'block' })}
                >
                  <option value="allow">allow</option>
                  <option value="warn">warn</option>
                  <option value="block">block</option>
                </select>
                <input
                  className="wf-rule-input wf-rule-condition"
                  type="text"
                  value={rule.condition || ''}
                  onChange={(e) => updateRule(idx, { condition: e.target.value })}
                  placeholder="condition (optional)"
                />
                <input
                  className="wf-rule-input wf-rule-message"
                  type="text"
                  value={rule.message || ''}
                  onChange={(e) => updateRule(idx, { message: e.target.value })}
                  placeholder="message (optional)"
                />
                <button
                  className="wf-rule-remove"
                  onClick={() => removeRule(idx)}
                  aria-label="Remove rule"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="wf-editor-actions">
        <button className="wf-action-danger" onClick={onRemove}>
          remove phase
        </button>
      </div>
    </div>
  );
}

interface TransitionEditorProps {
  phases: WorkflowPhaseConfig[];
  transitions: WorkflowTransition[];
  onUpdate: (transitions: WorkflowTransition[]) => void;
}

function TransitionEditor({ phases, transitions, onUpdate }: TransitionEditorProps) {
  const phaseNames = phases.map(p => p.name);

  const addTransition = () => {
    const newTransitions = [...transitions, { from: '', to: '' }];
    onUpdate(newTransitions);
  };

  const updateTransition = (idx: number, field: 'from' | 'to', value: string) => {
    const newTransitions = transitions.map((t, i) =>
      i === idx ? { ...t, [field]: value } : t
    );
    onUpdate(newTransitions);
  };

  const removeTransition = (idx: number) => {
    const newTransitions = transitions.filter((_, i) => i !== idx);
    onUpdate(newTransitions);
  };

  return (
    <div className="wf-transition-editor">
      <div className="wf-editor-section-header">
        <label className="wf-editor-label">Phase Transitions</label>
        <button className="wf-add-link" onClick={addTransition}>+ add transition</button>
      </div>
      {transitions.length > 0 && (
        <div className="wf-transitions-list">
          {transitions.map((t, idx) => (
            <div key={idx} className="wf-transition-row">
              <select
                className="wf-transition-select"
                value={t.from}
                onChange={(e) => updateTransition(idx, 'from', e.target.value)}
              >
                <option value="">Select from phase...</option>
                {phaseNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <span className="wf-transition-arrow">→</span>
              <select
                className="wf-transition-select"
                value={t.to}
                onChange={(e) => updateTransition(idx, 'to', e.target.value)}
              >
                <option value="">Select to phase...</option>
                {phaseNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <button
                className="wf-transition-remove"
                onClick={() => removeTransition(idx)}
                aria-label="Remove transition"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface WorkflowListViewProps {
  workflows: WorkflowConfig[];
  onOpenWorkflow: (wf: WorkflowConfig) => void;
  onCreateNew: () => void;
  onDuplicate: (wf: WorkflowConfig) => void;
}

function WorkflowListView({ workflows, onOpenWorkflow, onCreateNew, onDuplicate }: WorkflowListViewProps) {
  return (
    <div className="wf-list-view">
      <div className="wf-list-header">
        <h2 className="wf-list-title">Workflows</h2>
        <button className="wf-create-link" onClick={onCreateNew}>
          + New
        </button>
      </div>

      {workflows.length === 0 ? (
        <div className="wf-empty">
          <div className="wf-empty-text">No workflows yet</div>
          <div className="wf-empty-hint">
            Workflows define multi-phase agent orchestration with tool rules and context
          </div>
          <button className="wf-empty-cta" onClick={onCreateNew}>
            create your first workflow
          </button>
        </div>
      ) : (
        <div className="wf-list">
          {workflows.map((wf, idx) => (
            <div
              key={wf.name}
              className="wf-list-item"
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <div className="wf-list-item-main">
                <div className="wf-list-item-header">
                  <h3 className="wf-list-item-name">{wf.name}</h3>
                  {wf.builtin && <span className="wf-builtin-badge">built-in</span>}
                </div>
                {wf.description && <p className="wf-list-item-desc">{wf.description}</p>}
                <MiniPipeline phases={wf.phases ?? []} />
              </div>
              <div className="wf-list-item-side">
                <div className="wf-list-item-meta">
                  <span className="wf-meta-item">{(wf.phases ?? []).length} phase{(wf.phases ?? []).length !== 1 ? 's' : ''}</span>
                  {wf.transitions && wf.transitions.length > 0 && (
                    <span className="wf-meta-item">{wf.transitions.length} transition{wf.transitions.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="wf-list-item-actions">
                  <button
                    className="wf-list-action-link"
                    onClick={() => onOpenWorkflow(wf)}
                  >
                    {wf.builtin ? 'view' : 'edit'}
                  </button>
                  {!wf.builtin && (
                    <button
                      className="wf-list-action-link wf-list-action-secondary"
                      onClick={() => onDuplicate(wf)}
                    >
                      duplicate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface WorkflowDetailViewProps {
  workflow: WorkflowConfig;
  agents: Array<{ name: string; description: string; icon?: string }>;
  onBack: () => void;
  onSave: (wf: WorkflowConfig) => void;
  onDelete: (name: string) => void;
  onChange: (wf: WorkflowConfig) => void;
}

function WorkflowDetailView({ workflow, agents, onBack, onSave, onDelete, onChange }: WorkflowDetailViewProps) {
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState<number | null>(
    workflow.phases.length > 0 ? 0 : null
  );
  const [showYaml, setShowYaml] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleAddPhase = () => {
    const newPhase: WorkflowPhaseConfig = {
      name: `Phase ${workflow.phases.length + 1}`,
      context: '',
      agentHints: [],
      toolRules: [],
    };
    const newWorkflow = {
      ...workflow,
      phases: [...workflow.phases, newPhase],
    };
    onChange(newWorkflow);
    setSelectedPhaseIndex(newWorkflow.phases.length - 1);
  };

  const handleUpdatePhase = (idx: number, updates: Partial<WorkflowPhaseConfig>) => {
    const newPhases = workflow.phases.map((p, i) =>
      i === idx ? { ...p, ...updates } : p
    );
    onChange({ ...workflow, phases: newPhases });
  };

  const handleRemovePhase = (idx: number) => {
    const newPhases = workflow.phases.filter((_, i) => i !== idx);
    onChange({ ...workflow, phases: newPhases });
    if (selectedPhaseIndex === idx) {
      setSelectedPhaseIndex(newPhases.length > 0 ? 0 : null);
    } else if (selectedPhaseIndex !== null && selectedPhaseIndex > idx) {
      setSelectedPhaseIndex(selectedPhaseIndex - 1);
    }
  };

  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };

  const handleDrop = () => {
    if (dragIndex === null || dragOverIndex === null || dragIndex === dragOverIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    const phases = workflow.phases;
    const removed = phases[dragIndex];
    const without = phases.filter((_, i) => i !== dragIndex);
    const newPhases = [...without.slice(0, dragOverIndex), removed, ...without.slice(dragOverIndex)];

    onChange({ ...workflow, phases: newPhases });
    setSelectedPhaseIndex(dragOverIndex);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleUpdateTransitions = (transitions: WorkflowTransition[]) => {
    onChange({ ...workflow, transitions });
  };

  const handleSave = () => {
    onSave(workflow);
  };

  const handleDelete = () => {
    if (deleteConfirm) {
      onDelete(workflow.name);
    } else {
      setDeleteConfirm(true);
      setTimeout(() => setDeleteConfirm(false), 3000);
    }
  };

  const yamlContent = showYaml ? toYamlString(workflow).trim() : '';

  return (
    <div className="wf-detail-view">
      <div className="wf-detail-header">
        <button className="wf-back-link" onClick={onBack} aria-label="Back to list">
          ←
        </button>
        <div className="wf-detail-title-group">
          <input
            className="wf-detail-name-input"
            type="text"
            value={workflow.name}
            onChange={(e) => onChange({ ...workflow, name: e.target.value })}
            placeholder="Workflow name"
            disabled={workflow.builtin}
          />
          {workflow.builtin && <span className="wf-builtin-badge">built-in</span>}
        </div>
        <div className="wf-detail-actions">
          <button
            className="wf-yaml-toggle"
            onClick={() => setShowYaml(!showYaml)}
          >
            {showYaml ? 'editor' : 'yaml'}
          </button>
          {!workflow.builtin && (
            <>
              <button className="wf-action-primary" onClick={handleSave}>
                save
              </button>
              <button
                className="wf-action-danger"
                onClick={handleDelete}
              >
                {deleteConfirm ? 'confirm delete?' : 'delete'}
              </button>
            </>
          )}
        </div>
      </div>

      {showYaml ? (
        <div className="wf-yaml-viewer">
          <pre className="wf-yaml-block">{yamlContent}</pre>
        </div>
      ) : (
        <>
          <div className="wf-detail-meta">
            <label className="wf-meta-label">Description</label>
            <input
              className="wf-meta-input"
              type="text"
              value={workflow.description || ''}
              onChange={(e) => onChange({ ...workflow, description: e.target.value })}
              placeholder="Optional description"
              disabled={workflow.builtin}
            />
          </div>

          <div className="wf-pipeline-section">
            <label className="wf-pipeline-label">Phase Pipeline</label>
            <div className="wf-pipeline">
              {workflow.phases
                .map((phase, idx) => ({ phase, idx }))
                .filter(({ phase }) => phase.name.toLowerCase() !== 'idle')
                .map(({ phase, idx }) => (
                <React.Fragment key={idx}>
                  <div
                    draggable={!workflow.builtin}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={handleDrop}
                    className={dragOverIndex === idx ? 'drag-over' : ''}
                  >
                    <PhaseNode
                      phase={phase}
                      selected={selectedPhaseIndex === idx}
                      onClick={() => setSelectedPhaseIndex(idx)}
                    />
                  </div>
                </React.Fragment>
              ))}
              {!workflow.builtin && (
                <button className="wf-phase-add" onClick={handleAddPhase}>
                  +
                </button>
              )}
            </div>
          </div>

          {selectedPhaseIndex !== null && workflow.phases[selectedPhaseIndex] && !workflow.builtin && (
            <PhaseEditor
              phase={workflow.phases[selectedPhaseIndex]}
              agents={agents}
              onUpdate={(updates) => handleUpdatePhase(selectedPhaseIndex, updates)}
              onRemove={() => handleRemovePhase(selectedPhaseIndex)}
            />
          )}

          {!workflow.builtin && (
            <TransitionEditor
              phases={workflow.phases}
              transitions={workflow.transitions || []}
              onUpdate={handleUpdateTransitions}
            />
          )}
        </>
      )}
    </div>
  );
}

export function WorkflowsPanel() {
  const { workflows, agents, loading, saveWorkflow, deleteWorkflow } = useWorkflows();

  const [view, setView] = useState<'list' | 'detail'>('list');
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowConfig | null>(null);

  const handleOpenWorkflow = (wf: WorkflowConfig) => {
    setEditingWorkflow(wf);
    setView('detail');
  };

  const handleCreateNew = () => {
    const newWorkflow: WorkflowConfig = {
      name: 'New Workflow',
      description: '',
      phases: [],
      transitions: [],
    };
    setEditingWorkflow(newWorkflow);
    setView('detail');
  };

  const handleDuplicate = (wf: WorkflowConfig) => {
    const duplicated: WorkflowConfig = {
      ...wf,
      name: `${wf.name} (copy)`,
      builtin: false,
    };
    setEditingWorkflow(duplicated);
    setView('detail');
  };

  const handleBack = () => {
    setView('list');
    setEditingWorkflow(null);
  };

  const handleSave = async (wf: WorkflowConfig) => {
    const success = await saveWorkflow(wf);
    if (success) {
      handleBack();
    }
  };

  const handleDelete = async (name: string) => {
    const success = await deleteWorkflow(name);
    if (success) {
      handleBack();
    }
  };

  const handleChange = (wf: WorkflowConfig) => {
    setEditingWorkflow(wf);
  };

  if (loading) {
    return (
      <div className="workflows-panel">
        <div className="wf-loading">Loading workflows...</div>
      </div>
    );
  }

  return (
    <div className="workflows-panel">
      <div className="wf-content">
        {view === 'list' ? (
          <WorkflowListView
            workflows={workflows}
            onOpenWorkflow={handleOpenWorkflow}
            onCreateNew={handleCreateNew}
            onDuplicate={handleDuplicate}
          />
        ) : editingWorkflow ? (
          <WorkflowDetailView
            workflow={editingWorkflow}
            agents={agents}
            onBack={handleBack}
            onSave={handleSave}
            onDelete={handleDelete}
            onChange={handleChange}
          />
        ) : null}
      </div>
    </div>
  );
}
