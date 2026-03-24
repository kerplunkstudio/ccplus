import React, { useState } from 'react';
import { useWorkflows, WorkflowConfig, WorkflowPhaseConfig, ToolRule, AgentInfo } from '../hooks/useWorkflows';
import { AGENT_ICONS } from '../constants/agentIcons';
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
  const filtered = phases.filter(p => p.name.toLowerCase() !== 'idle' && p.name.toLowerCase() !== 'complete');
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

function AgentIconSvg({ iconKey, size = 16 }: { iconKey?: string; size?: number }) {
  const iconData = iconKey ? AGENT_ICONS[iconKey] : undefined;
  if (!iconData) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={iconData.path} />
    </svg>
  );
}

interface AgentCardProps {
  agentName: string;
  iconKey?: string;
  onRemove?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

function AgentCard({ agentName, iconKey, onRemove, draggable = false, onDragStart }: AgentCardProps) {
  return (
    <div
      className="wf-agent-card"
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="wf-agent-card-avatar">
        {iconKey && AGENT_ICONS[iconKey]
          ? <AgentIconSvg iconKey={iconKey} size={14} />
          : agentName.charAt(0).toUpperCase()
        }
      </span>
      <span className="wf-agent-card-name">{agentName}</span>
      {onRemove && (
        <button
          className="wf-agent-card-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label={`Remove ${agentName}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

interface PhaseCardProps {
  phase: WorkflowPhaseConfig;
  agents: AgentInfo[];
  selected: boolean;
  onClick: () => void;
  onRemove?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onAgentRemove?: (agentName: string) => void;
  onAgentDragStart?: (agentName: string, e: React.DragEvent) => void;
  dragOver?: boolean;
}

function PhaseCard({
  phase,
  agents,
  selected,
  onClick,
  onRemove,
  onDrop,
  onDragOver,
  onDragLeave,
  onAgentRemove,
  onAgentDragStart,
  dragOver = false,
}: PhaseCardProps) {
  const agentHints = phase.agentHints || [];
  const ruleCount = phase.toolRules?.length || 0;

  const resolveAgent = (agentId: string): { displayName: string; icon?: string } => {
    const agent = agents.find(a => a.id === agentId);
    return {
      displayName: agent?.name || agentId,
      icon: agent?.icon,
    };
  };

  return (
    <div
      className={`wf-phase-card ${selected ? 'selected' : ''} ${dragOver ? 'drag-over' : ''}`}
      onClick={onClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="wf-phase-card-header">
        <div className="wf-phase-card-name">{phase.name}</div>
        <div className="wf-phase-card-header-right">
          <div className="wf-phase-card-rule-count">{ruleCount} rule{ruleCount !== 1 ? 's' : ''}</div>
          {onRemove && (
            <button
              className="wf-phase-card-remove"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              aria-label={`Remove ${phase.name}`}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {agentHints.length === 0 && (
        <div className="wf-phase-drop-hint">Drop agents here</div>
      )}

      {agentHints.length > 0 && (
        <div className="wf-phase-agents">
          {agentHints.map(agentId => {
            const { displayName, icon } = resolveAgent(agentId);
            return (
              <AgentCard
                key={agentId}
                agentName={displayName}
                iconKey={icon}
                onRemove={() => onAgentRemove?.(agentId)}
                draggable
                onDragStart={(e) => onAgentDragStart?.(agentId, e)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface AgentLibraryProps {
  agents: AgentInfo[];
  onClose: () => void;
  onAgentDragStart: (agentId: string, e: React.DragEvent) => void;
}

function AgentLibrary({ agents, onClose, onAgentDragStart }: AgentLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="wf-agent-library">
      <div className="wf-agent-library-header">
        <span className="wf-agent-library-title">Agent Library</span>
        <button
          className="wf-agent-library-close"
          onClick={onClose}
          aria-label="Close agent library"
        >
          ×
        </button>
      </div>

      <input
        className="wf-agent-library-search"
        type="text"
        placeholder="Search agents..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <div className="wf-agent-library-list">
        {filteredAgents.length === 0 ? (
          <div className="wf-agent-library-empty">No agents found</div>
        ) : (
          filteredAgents.map((agent) => {
            const hasIcon = agent.icon && AGENT_ICONS[agent.icon];
            return (
              <div
                key={agent.id}
                className="wf-agent-library-item"
                draggable
                onDragStart={(e) => onAgentDragStart(agent.id, e)}
                title={agent.description}
              >
                <span className="wf-agent-library-handle">⋮⋮</span>
                <span className="wf-agent-library-avatar">
                  {hasIcon
                    ? <AgentIconSvg iconKey={agent.icon} size={14} />
                    : agent.name.charAt(0).toUpperCase()
                  }
                </span>
                <span className="wf-agent-library-name">{agent.name}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface PhaseEditorProps {
  phase: WorkflowPhaseConfig;
  onUpdate: (updates: Partial<WorkflowPhaseConfig>) => void;
  onClose: () => void;
}

function PhaseEditor({ phase, onUpdate, onClose }: PhaseEditorProps) {
  const rules = phase.toolRules || [];
  const overlayRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

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
    <div className="wf-phase-overlay" ref={overlayRef} onClick={onClose}>
      <div className="wf-phase-editor" onClick={(e) => e.stopPropagation()}>
        <div className="wf-phase-editor-header">
          <span className="wf-phase-editor-title">{phase.name}</span>
          <button className="wf-phase-editor-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="wf-phase-editor-body">
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
              placeholder="Optional context for this phase — injected into the agent system prompt"
              rows={4}
            />
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
                    <select
                      className="wf-rule-select wf-rule-tool"
                      value={rule.tool}
                      onChange={(e) => updateRule(idx, { tool: e.target.value })}
                    >
                      <option value="">select tool</option>
                      {['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent', 'WebSearch', 'WebFetch', 'NotebookEdit', 'EnterPlanMode'].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
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
                      placeholder="condition"
                    />
                    <input
                      className="wf-rule-input wf-rule-message"
                      type="text"
                      value={rule.message || ''}
                      onChange={(e) => updateRule(idx, { message: e.target.value })}
                      placeholder="message"
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
            {rules.length === 0 && (
              <div className="wf-rules-empty">No tool rules. Add rules to control which tools agents can use in this phase.</div>
            )}
          </div>
        </div>
      </div>
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
                  <span className="wf-meta-item">{(wf.phases ?? []).filter(p => p.name.toLowerCase() !== 'idle' && p.name.toLowerCase() !== 'complete').length} phases</span>
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
  agents: AgentInfo[];
  onBack: () => void;
  onSave: (wf: WorkflowConfig) => void;
  onDelete: (name: string) => void;
  onChange: (wf: WorkflowConfig) => void;
}

function WorkflowDetailView({ workflow, agents, onBack, onSave, onDelete, onChange }: WorkflowDetailViewProps) {
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState<number | null>(null);
  const [showYaml, setShowYaml] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [showAgentLibrary, setShowAgentLibrary] = useState(true);
  const [dragOverPhaseIndex, setDragOverPhaseIndex] = useState<number | null>(null);

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

  const handleLibraryAgentDragStart = (agentName: string, e: React.DragEvent) => {
    e.dataTransfer.setData('application/agent', JSON.stringify({ name: agentName, source: 'library' }));
  };

  const handlePhaseAgentDragStart = (phaseIndex: number, agentName: string, e: React.DragEvent) => {
    e.dataTransfer.setData('application/agent', JSON.stringify({
      name: agentName,
      source: 'phase',
      sourcePhaseIndex: phaseIndex
    }));
    e.stopPropagation();
  };

  const handlePhaseDragOver = (e: React.DragEvent, phaseIndex: number) => {
    e.preventDefault();
    setDragOverPhaseIndex(phaseIndex);
  };

  const handlePhaseDragLeave = () => {
    setDragOverPhaseIndex(null);
  };

  const handlePhaseDrop = (e: React.DragEvent, phaseIndex: number) => {
    e.preventDefault();
    setDragOverPhaseIndex(null);

    const dataString = e.dataTransfer.getData('application/agent');
    if (!dataString) return;

    try {
      const data = JSON.parse(dataString) as {
        name: string;
        source: 'library' | 'phase';
        sourcePhaseIndex?: number;
      };

      const targetPhase = workflow.phases[phaseIndex];
      const currentAgents = targetPhase.agentHints || [];

      // Prevent duplicates in target phase
      if (currentAgents.includes(data.name)) {
        return;
      }

      if (data.source === 'library') {
        // Add agent from library to phase
        const newPhases = workflow.phases.map((p, i) => {
          if (i === phaseIndex) {
            return {
              ...p,
              agentHints: [...currentAgents, data.name]
            };
          }
          return p;
        });
        onChange({ ...workflow, phases: newPhases });
      } else if (data.source === 'phase' && data.sourcePhaseIndex !== undefined) {
        // Move agent from one phase to another
        const newPhases = workflow.phases.map((p, i) => {
          if (i === data.sourcePhaseIndex) {
            return {
              ...p,
              agentHints: (p.agentHints || []).filter(a => a !== data.name)
            };
          }
          if (i === phaseIndex) {
            return {
              ...p,
              agentHints: [...currentAgents, data.name]
            };
          }
          return p;
        });
        onChange({ ...workflow, phases: newPhases });
      }
    } catch (error) {
      console.error('Failed to parse drag data:', error);
    }
  };

  const handleAgentRemove = (phaseIndex: number, agentName: string) => {
    const newPhases = workflow.phases.map((p, i) => {
      if (i === phaseIndex) {
        return {
          ...p,
          agentHints: (p.agentHints || []).filter(a => a !== agentName)
        };
      }
      return p;
    });
    onChange({ ...workflow, phases: newPhases });
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
          <button
            className="wf-yaml-toggle"
            onClick={() => setShowAgentLibrary(!showAgentLibrary)}
          >
            {showAgentLibrary ? 'hide library' : 'show library'}
          </button>
          <button className="wf-action-primary" onClick={handleSave}>
            save
          </button>
          {!workflow.builtin && (
            <button
              className="wf-action-danger"
              onClick={handleDelete}
            >
              {deleteConfirm ? 'confirm delete?' : 'delete'}
            </button>
          )}
        </div>
      </div>

      {showYaml ? (
        <div className="wf-yaml-viewer">
          <pre className="wf-yaml-block">{yamlContent}</pre>
        </div>
      ) : (
        <div className="wf-detail-layout">
          <div className="wf-detail-main">
            <div className="wf-detail-meta">
              <label className="wf-meta-label">Description</label>
              <input
                className="wf-meta-input"
                type="text"
                value={workflow.description || ''}
                onChange={(e) => onChange({ ...workflow, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>

            <div className="wf-pipeline-section">
              <label className="wf-pipeline-label">Phase Pipeline</label>
              <div className="wf-pipeline-cards">
                {workflow.phases
                  .map((phase, idx) => ({ phase, idx }))
                  .filter(({ phase }) => phase.name.toLowerCase() !== 'idle' && phase.name.toLowerCase() !== 'complete')
                  .map(({ phase, idx }) => (
                    <PhaseCard
                      key={idx}
                      phase={phase}
                      agents={agents}
                      selected={selectedPhaseIndex === idx}
                      onClick={() => setSelectedPhaseIndex(selectedPhaseIndex === idx ? null : idx)}
                      onRemove={() => handleRemovePhase(idx)}
                      onDrop={(e) => handlePhaseDrop(e, idx)}
                      onDragOver={(e) => handlePhaseDragOver(e, idx)}
                      onDragLeave={handlePhaseDragLeave}
                      onAgentRemove={(agentName) => handleAgentRemove(idx, agentName)}
                      onAgentDragStart={(agentName, e) => handlePhaseAgentDragStart(idx, agentName, e)}
                      dragOver={dragOverPhaseIndex === idx}
                    />
                  ))}
                <button className="wf-phase-add-card" onClick={handleAddPhase}>
                  + Add Phase
                </button>
              </div>
            </div>


          </div>

          {showAgentLibrary && (
            <AgentLibrary
              agents={agents}
              onClose={() => setShowAgentLibrary(false)}
              onAgentDragStart={handleLibraryAgentDragStart}
            />
          )}
        </div>
      )}

      {selectedPhaseIndex !== null && workflow.phases[selectedPhaseIndex] && (
        <PhaseEditor
          phase={workflow.phases[selectedPhaseIndex]}
          onUpdate={(updates) => handleUpdatePhase(selectedPhaseIndex, updates)}
          onClose={() => setSelectedPhaseIndex(null)}
        />
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
