import './settings-shared.css'
import './WorkflowPanel.css'
import SettingsToggleRow from './SettingsToggleRow'

interface WorkflowPanelProps {
  config: {
    enforcement_enabled: boolean
    worktrees_enabled: boolean
    code_review_gate: boolean
    test_coverage_gate: boolean
  } | null
  onUpdate: (key: string, value: unknown) => void
}

export default function WorkflowPanel({ config, onUpdate }: WorkflowPanelProps) {
  const cfg = config ?? {
    enforcement_enabled: true,
    worktrees_enabled: true,
    code_review_gate: true,
    test_coverage_gate: true,
  }

  const enforcementOff = !cfg.enforcement_enabled

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <h2 className="panel-title">Workflow</h2>
        <p className="panel-description">Enforcement rules that gate commits and PRs.</p>
      </div>

      <div className="settings-list">
        <SettingsToggleRow
          label="Workflow Enforcement"
          description="Master switch for all workflow gates"
          checked={cfg.enforcement_enabled}
          onChange={(value) => onUpdate('enforcement_enabled', value)}
        />
        <SettingsToggleRow
          label="Worktrees Enabled"
          description="Enable Git worktree support for isolated parallel sessions"
          checked={cfg.worktrees_enabled}
          onChange={(value) => onUpdate('worktrees_enabled', value)}
        />
        <SettingsToggleRow
          label="Code Review Gate"
          description="Require code-reviewer agent to pass before committing"
          checked={cfg.code_review_gate}
          disabled={enforcementOff}
          onChange={(value) => onUpdate('code_review_gate', value)}
        />
        <SettingsToggleRow
          label="Test Coverage Gate"
          description="Require tests to pass before committing"
          checked={cfg.test_coverage_gate}
          disabled={enforcementOff}
          onChange={(value) => onUpdate('test_coverage_gate', value)}
        />
      </div>
    </div>
  )
}
