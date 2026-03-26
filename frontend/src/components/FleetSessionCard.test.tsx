import { render, screen } from '@testing-library/react';
import { FleetSessionCard } from './FleetSessionCard';
import { FleetSession } from '../types';

const baseSession: FleetSession = {
  sessionId: 'test-session-123',
  status: 'running',
  workspace: '/Users/test/project/myapp',
  toolCount: 5,
  totalAgents: 2,
  inputTokens: 1000,
  outputTokens: 500,
  durationMs: 30000,
  startedAt: new Date().toISOString(),
  lastActivity: new Date().toISOString(),
  label: 'Test session label',
  filesTouched: ['file1.ts', 'file2.ts'],
};

describe('FleetSessionCard', () => {
  const mockOnClick = jest.fn();

  beforeEach(() => {
    mockOnClick.mockClear();
  });

  it('renders without crashing', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('myapp')).toBeInTheDocument();
  });

  it('displays project name correctly', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('myapp')).toBeInTheDocument();
  });

  it('displays session label', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('Test session label')).toBeInTheDocument();
  });

  it('displays status pill with correct status', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('displays tool count stat', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('tools')).toBeInTheDocument();
  });

  it('displays total agents stat', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('agents')).toBeInTheDocument();
  });

  it('displays token counts', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('1.5K')).toBeInTheDocument(); // Total tokens
  });

  describe('workflow visualization', () => {
    it('does not show workflow name when workflowName is undefined', () => {
      const { container } = render(
        <FleetSessionCard session={baseSession} onClick={mockOnClick} />
      );
      const workflow = container.querySelector('.fleet-card-workflow');
      expect(workflow).not.toBeInTheDocument();
    });

    it('does not show workflow name when workflowName is "default"', () => {
      const sessionWithDefault: FleetSession = {
        ...baseSession,
        workflowName: 'default',
        workflowPhase: 'execute',
      };
      const { container } = render(
        <FleetSessionCard session={sessionWithDefault} onClick={mockOnClick} />
      );
      const workflow = container.querySelector('.fleet-card-workflow');
      expect(workflow).not.toBeInTheDocument();
    });

    it('shows workflow name when workflowName exists and is not "default"', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        workflowName: 'feature',
        workflowPhase: 'execute',
      };
      render(<FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />);
      expect(screen.getByText('feature')).toBeInTheDocument();
    });

    it('displays workflow name for bug-fix workflow', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        workflowName: 'bug-fix',
        workflowPhase: 'test',
      };
      render(<FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />);
      expect(screen.getByText('bug-fix')).toBeInTheDocument();
    });
  });

  describe('status display', () => {
    it('shows "done" for completed status', () => {
      const completedSession: FleetSession = {
        ...baseSession,
        status: 'completed',
      };
      render(<FleetSessionCard session={completedSession} onClick={mockOnClick} />);
      expect(screen.getByText('done')).toBeInTheDocument();
    });

    it('shows "failed" for failed status', () => {
      const failedSession: FleetSession = {
        ...baseSession,
        status: 'failed',
      };
      render(<FleetSessionCard session={failedSession} onClick={mockOnClick} />);
      expect(screen.getByText('failed')).toBeInTheDocument();
    });

    it('shows "idle" for idle status', () => {
      const idleSession: FleetSession = {
        ...baseSession,
        status: 'idle',
      };
      render(<FleetSessionCard session={idleSession} onClick={mockOnClick} />);
      expect(screen.getByText('idle')).toBeInTheDocument();
    });

    it('shows phase name in status pill for running session with workflow', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        status: 'running',
        workflowName: 'feature',
        workflowPhase: 'execute',
      };
      render(<FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />);
      expect(screen.getByText('Execute')).toBeInTheDocument();
    });
  });

  describe('interaction', () => {
    it('calls onClick with sessionId when clicked', () => {
      const { container } = render(
        <FleetSessionCard session={baseSession} onClick={mockOnClick} />
      );
      const card = container.querySelector('.fleet-session-card');
      card?.click();
      expect(mockOnClick).toHaveBeenCalledWith('test-session-123');
    });
  });

  describe('label truncation', () => {
    it('truncates long labels', () => {
      const longLabel = 'a'.repeat(100);
      const sessionWithLongLabel: FleetSession = {
        ...baseSession,
        label: longLabel,
      };
      render(<FleetSessionCard session={sessionWithLongLabel} onClick={mockOnClick} />);
      const truncated = 'a'.repeat(80) + '…';
      expect(screen.getByText(truncated)).toBeInTheDocument();
    });

    it('does not truncate short labels', () => {
      const shortLabel = 'Short label';
      const sessionWithShortLabel: FleetSession = {
        ...baseSession,
        label: shortLabel,
      };
      render(<FleetSessionCard session={sessionWithShortLabel} onClick={mockOnClick} />);
      expect(screen.getByText(shortLabel)).toBeInTheDocument();
    });
  });
});
