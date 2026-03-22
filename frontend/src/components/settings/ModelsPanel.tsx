import './settings-shared.css'
import './ModelsPanel.css';

interface ModelsPanelProps {
  config: {
    sdk_model: string;
    captain_model: string;
    memory_distill_model: string;
    agent_overrides: {
      code_agent: string;
      explore: string;
      code_reviewer: string;
      orchestrator: string;
    };
  } | null;
  onUpdate: (key: string, value: string) => void;
}

const MAIN_MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

const OVERRIDE_MODELS = [
  { id: 'inherit', label: 'Inherit (Default SDK Model)' },
  ...MAIN_MODELS,
];

interface SettingRowProps {
  label: string;
  description: string;
  value: string;
  options: { id: string; label: string }[];
  configKey: string;
  onUpdate: (key: string, value: string) => void;
  inheritedModel?: string;
}

function SettingRow({ label, description, value, options, configKey, onUpdate, inheritedModel }: SettingRowProps) {
  return (
    <div className="model-row">
      <div className="model-row-label">
        <div className="model-row-name">{label}</div>
        <div className="model-row-desc">{description}</div>
      </div>
      <div className="model-row-control">
        {value === 'inherit' && inheritedModel && (
          <span className="model-inherit-hint">→ {inheritedModel}</span>
        )}
        <select
          className="model-select"
          value={value}
          onChange={(e) => onUpdate(configKey, e.target.value)}
        >
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton-block skeleton-label" />
          <div className="skeleton-block skeleton-control" />
        </div>
      ))}
    </>
  );
}

export default function ModelsPanel({ config, onUpdate }: ModelsPanelProps) {
  if (!config) {
    return (
      <div className="models-skeleton">
        <div className="skeleton-block skeleton-title" />
        <SkeletonRows count={3} />
        <div className="skeleton-block skeleton-subheader" />
        <SkeletonRows count={4} />
      </div>
    );
  }

  const sdkModel = config.sdk_model ?? 'claude-sonnet-4-6';

  const mainSettings: SettingRowProps[] = [
    {
      label: 'Default SDK Model',
      description: 'Used by all agents unless overridden below.',
      value: sdkModel,
      options: MAIN_MODELS,
      configKey: 'sdk_model',
      onUpdate,
    },
    {
      label: 'Captain Model',
      description: 'Model used by the Captain orchestrator.',
      value: config.captain_model ?? 'claude-opus-4-6',
      options: MAIN_MODELS,
      configKey: 'captain_model',
      onUpdate,
    },
    {
      label: 'Memory Distillation Model',
      description: 'Model used to distill and summarize memory.',
      value: config.memory_distill_model ?? 'claude-haiku-4-5-20251001',
      options: MAIN_MODELS,
      configKey: 'memory_distill_model',
      onUpdate,
    },
  ];

  const agentOverrides: SettingRowProps[] = [
    {
      label: 'code_agent',
      description: 'Executes code modifications and file operations.',
      value: config.agent_overrides?.code_agent ?? 'inherit',
      options: OVERRIDE_MODELS,
      configKey: 'agent_overrides.code_agent',
      onUpdate,
      inheritedModel: sdkModel,
    },
    {
      label: 'explore',
      description: 'Fast codebase exploration and search agent.',
      value: config.agent_overrides?.explore ?? 'inherit',
      options: OVERRIDE_MODELS,
      configKey: 'agent_overrides.explore',
      onUpdate,
      inheritedModel: sdkModel,
    },
    {
      label: 'code-reviewer',
      description: 'Code quality, security, and maintainability review.',
      value: config.agent_overrides?.code_reviewer ?? 'inherit',
      options: OVERRIDE_MODELS,
      configKey: 'agent_overrides.code_reviewer',
      onUpdate,
      inheritedModel: sdkModel,
    },
    {
      label: 'orchestrator',
      description: 'Coordinates multi-agent workflows.',
      value: config.agent_overrides?.orchestrator ?? 'inherit',
      options: OVERRIDE_MODELS,
      configKey: 'agent_overrides.orchestrator',
      onUpdate,
      inheritedModel: sdkModel,
    },
  ];

  return (
    <div className="models-panel">
      <div className="models-panel-header">
        <h2 className="models-panel-title">Models</h2>
        <p className="models-panel-description">Which Claude model runs where. All changes apply immediately.</p>
      </div>

      <div className="models-section">
        {mainSettings.map((setting) => (
          <SettingRow key={setting.configKey} {...setting} />
        ))}
      </div>

      <div className="models-section">
        <div className="models-section-header">
          <h3 className="models-section-title">Per-Agent Overrides</h3>
          <p className="models-section-desc">Override the default model for specific agents. &apos;Inherit&apos; uses the Default SDK Model.</p>
        </div>
        {agentOverrides.map((setting) => (
          <SettingRow key={setting.configKey} {...setting} />
        ))}
      </div>
    </div>
  );
}
