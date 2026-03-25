import { render, screen } from '@testing-library/react';
import { FleetSessionCard } from './FleetSessionCard';
import { FleetSession } from '../types';

const baseSession: FleetSession = {
  sessionId: 'test-session-123',
  status: 'running',
  workspace: '/Users/test/project/myapp',
  toolCount: 5,
  activeAgents: 2,
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

  it('displays active agents stat', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('agents')).toBeInTheDocument();
  });

  it('displays token counts', () => {
    render(<FleetSessionCard session={baseSession} onClick={mockOnClick} />);
    expect(screen.getByText('1.5K')).toBeInTheDocument(); // Total tokens
  });

  describe('workflow visualization', () => {
    it('does not show workflow track when workflowName is undefined', () => {
      const { container } = render(
        <FleetSessionCard session={baseSession} onClick={mockOnClick} />
      );
      const workflowTrack = container.querySelector('.fleet-workflow-track');
      expect(workflowTrack).not.toBeInTheDocument();
    });

    it('does not show workflow track when workflowName is "default"', () => {
      const sessionWithDefault: FleetSession = {
        ...baseSession,
        workflowName: 'default',
        workflowPhase: 'execute',
      };
      const { container } = render(
        <FleetSessionCard session={sessionWithDefault} onClick={mockOnClick} />
      );
      const workflowTrack = container.querySelector('.fleet-workflow-track');
      expect(workflowTrack).not.toBeInTheDocument();
    });

    it('shows workflow track when workflowName exists and is not "default"', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        workflowName: 'feature',
        workflowPhase: 'execute',
      };
      const { container } = render(
        <FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />
      );
      const workflowTrack = container.querySelector('.fleet-workflow-track');
      expect(workflowTrack).toBeInTheDocument();
    });

    it('displays workflow name in the track', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        workflowName: 'bug-fix',
        workflowPhase: 'test',
      };
      render(<FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />);
      expect(screen.getByText('bug-fix')).toBeInTheDocument();
    });

    it('renders all phase segments', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        workflowName: 'feature',
        workflowPhase: 'execute',
      };
      const { container } = render(
        <FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />
      );
      const segments = container.querySelectorAll('.fleet-phase-segment');
      expect(segments).toHaveLength(6); // design, plan, execute, test, review, complete
    });

    it('highlights current phase for running session', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        status: 'running',
        workflowName: 'feature',
        workflowPhase: 'execute',
      };
      const { container } = render(
        <FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />
      );
      const segments = container.querySelectorAll('.fleet-phase-segment');

      // design (past), plan (past), execute (current), test (future), review (future), complete (future)
      expect(segments[0]).toHaveClass('phase-past'); // design
      expect(segments[1]).toHaveClass('phase-past'); // plan
      expect(segments[2]).toHaveClass('phase-current'); // execute
      expect(segments[3]).toHaveClass('phase-future'); // test
      expect(segments[4]).toHaveClass('phase-future'); // review
      expect(segments[5]).toHaveClass('phase-future'); // complete
    });

    it('marks all phases as past for completed session', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        status: 'completed',
        workflowName: 'feature',
        workflowPhase: 'complete',
      };
      const { container } = render(
        <FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />
      );
      const segments = container.querySelectorAll('.fleet-phase-segment');

      // All phases up to complete should be past
      expect(segments[0]).toHaveClass('phase-past'); // design
      expect(segments[1]).toHaveClass('phase-past'); // plan
      expect(segments[2]).toHaveClass('phase-past'); // execute
      expect(segments[3]).toHaveClass('phase-past'); // test
      expect(segments[4]).toHaveClass('phase-past'); // review
      expect(segments[5]).toHaveClass('phase-past'); // complete
    });

    it('highlights failure phase for failed session', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        status: 'failed',
        workflowName: 'feature',
        workflowPhase: 'test',
      };
      const { container } = render(
        <FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />
      );
      const segments = container.querySelectorAll('.fleet-phase-segment');

      // Past phases before failure
      expect(segments[0]).toHaveClass('phase-past'); // design
      expect(segments[1]).toHaveClass('phase-past'); // plan
      expect(segments[2]).toHaveClass('phase-past'); // execute

      // Failed phase
      expect(segments[3]).toHaveClass('phase-current'); // test (failed here)

      // Future phases
      expect(segments[4]).toHaveClass('phase-future'); // review
      expect(segments[5]).toHaveClass('phase-future'); // complete
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

    it('does not include phase in status pill even when workflow exists', () => {
      const sessionWithWorkflow: FleetSession = {
        ...baseSession,
        status: 'running',
        workflowName: 'feature',
        workflowPhase: 'execute',
      };
      render(<FleetSessionCard session={sessionWithWorkflow} onClick={mockOnClick} />);

      // Status pill should only show "running", not "Execute · feature"
      const statusText = screen.getByText('running');
      expect(statusText).toBeInTheDocument();
      expect(screen.queryByText(/Execute/)).not.toBeInTheDocument();
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
