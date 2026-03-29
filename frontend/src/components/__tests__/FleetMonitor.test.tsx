import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FleetMonitor } from '../FleetMonitor';
import { FleetState } from '../../types';

// Mock FleetSessionCard to avoid deep rendering dependencies
jest.mock('../FleetSessionCard', () => ({
  FleetSessionCard: ({ session, onClick }: { session: { sessionId: string; label: string }; onClick: (id: string) => void }) => (
    <div data-testid={`session-card-${session.sessionId}`} onClick={() => onClick(session.sessionId)}>
      {session.label}
    </div>
  ),
}));

// Mock CSS import
jest.mock('../FleetMonitor.css', () => ({}), { virtual: true });

const makeSession = (overrides: Partial<import('../../types').FleetSession>): import('../../types').FleetSession => ({
  sessionId: 'session-1',
  status: 'completed',
  workspace: '/home/user/project',
  toolCount: 5,
  activeAgents: 0,
  totalAgents: 1,
  inputTokens: 1000,
  outputTokens: 500,
  durationMs: 30000,
  startedAt: '2026-01-01T10:00:00.000Z',
  lastActivity: '2026-01-01T10:30:00.000Z',
  label: 'Test Session',
  filesTouched: [],
  ...overrides,
});

const makeFleetState = (sessions: import('../../types').FleetSession[]): FleetState => ({
  sessions,
  aggregate: {
    totalSessions: sessions.length,
    activeSessions: sessions.filter((s) => s.status === 'running' || s.status === 'idle').length,
    totalToolCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  },
});

describe('FleetMonitor — cancelled session regression', () => {
  const onSessionClick = jest.fn();

  beforeEach(() => {
    onSessionClick.mockClear();
  });

  /**
   * REGRESSION TEST: cancelled sessions must appear in the Past tab.
   *
   * Before the fix (missing `|| s.status === 'cancelled'` in the Past filter),
   * switching to the "Past" tab would not render cards for cancelled sessions —
   * they fell through all status checks and were silently dropped.
   *
   * This test FAILS on code that lacks the fix and PASSES after the fix.
   */
  it('shows cancelled sessions in the Past tab', () => {
    const cancelledSession = makeSession({
      sessionId: 'cancelled-1',
      status: 'cancelled',
      label: 'Cancelled Session',
    });

    const fleetState = makeFleetState([cancelledSession]);

    render(<FleetMonitor fleetState={fleetState} onSessionClick={onSessionClick} />);

    // Switch to Past tab
    const pastButton = screen.getByRole('button', { name: /Past/i });
    fireEvent.click(pastButton);

    // The cancelled session card must be present
    expect(screen.getByTestId('session-card-cancelled-1')).toBeInTheDocument();
    expect(screen.getByText('Cancelled Session')).toBeInTheDocument();
  });

  /**
   * REGRESSION TEST: pastCount must include cancelled sessions.
   *
   * Before the fix, cancelled sessions were excluded from `pastCount`, so the
   * "Past" button showed no count even when there were cancelled sessions present.
   *
   * This test FAILS on code that lacks the fix and PASSES after the fix.
   */
  it('includes cancelled sessions in the Past button count', () => {
    const cancelledSession = makeSession({
      sessionId: 'cancelled-2',
      status: 'cancelled',
      label: 'Another Cancelled Session',
    });

    const fleetState = makeFleetState([cancelledSession]);

    render(<FleetMonitor fleetState={fleetState} onSessionClick={onSessionClick} />);

    // pastCount > 0 causes the button to render "Past (N)"
    expect(screen.getByRole('button', { name: /Past \(1\)/i })).toBeInTheDocument();
  });

  // ── Baseline / non-regression tests ─────────────────────────────────────

  it('shows completed sessions in the Past tab', () => {
    const completedSession = makeSession({
      sessionId: 'completed-1',
      status: 'completed',
      label: 'Completed Session',
    });

    render(<FleetMonitor fleetState={makeFleetState([completedSession])} onSessionClick={onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    expect(screen.getByTestId('session-card-completed-1')).toBeInTheDocument();
  });

  it('shows failed sessions in the Past tab', () => {
    const failedSession = makeSession({
      sessionId: 'failed-1',
      status: 'failed',
      label: 'Failed Session',
    });

    render(<FleetMonitor fleetState={makeFleetState([failedSession])} onSessionClick={onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    expect(screen.getByTestId('session-card-failed-1')).toBeInTheDocument();
  });

  it('does NOT show cancelled sessions in the Active tab', () => {
    const cancelledSession = makeSession({
      sessionId: 'cancelled-3',
      status: 'cancelled',
      label: 'Cancelled In Active Check',
    });

    render(<FleetMonitor fleetState={makeFleetState([cancelledSession])} onSessionClick={onSessionClick} />);

    // Default view is Active — the cancelled session must not appear there
    expect(screen.queryByTestId('session-card-cancelled-3')).not.toBeInTheDocument();
  });

  it('shows running and idle sessions in the Active tab', () => {
    const runningSession = makeSession({ sessionId: 'running-1', status: 'running', label: 'Running' });
    const idleSession = makeSession({ sessionId: 'idle-1', status: 'idle', label: 'Idle', startedAt: '2026-01-01T09:00:00.000Z' });

    render(<FleetMonitor fleetState={makeFleetState([runningSession, idleSession])} onSessionClick={onSessionClick} />);

    expect(screen.getByTestId('session-card-running-1')).toBeInTheDocument();
    expect(screen.getByTestId('session-card-idle-1')).toBeInTheDocument();
  });

  it('pastCount reflects all three terminal statuses together', () => {
    const sessions = [
      makeSession({ sessionId: 'c-1', status: 'completed', label: 'C1', startedAt: '2026-01-01T10:00:00.000Z' }),
      makeSession({ sessionId: 'f-1', status: 'failed', label: 'F1', startedAt: '2026-01-01T09:00:00.000Z' }),
      makeSession({ sessionId: 'x-1', status: 'cancelled', label: 'X1', startedAt: '2026-01-01T08:00:00.000Z' }),
    ];

    render(<FleetMonitor fleetState={makeFleetState(sessions)} onSessionClick={onSessionClick} />);

    // All three terminal sessions must be counted → "Past (3)"
    expect(screen.getByRole('button', { name: /Past \(3\)/i })).toBeInTheDocument();
  });

  it('shows empty state message when no past sessions exist', () => {
    const runningSession = makeSession({ sessionId: 'running-2', status: 'running', label: 'Running' });

    render(<FleetMonitor fleetState={makeFleetState([runningSession])} onSessionClick={onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
  });

  it('calls onSessionClick with the session id when a card is clicked', () => {
    const cancelledSession = makeSession({
      sessionId: 'cancelled-click',
      status: 'cancelled',
      label: 'Clickable Cancelled',
    });

    render(<FleetMonitor fleetState={makeFleetState([cancelledSession])} onSessionClick={onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Past/i }));
    fireEvent.click(screen.getByTestId('session-card-cancelled-click'));

    expect(onSessionClick).toHaveBeenCalledTimes(1);
    expect(onSessionClick).toHaveBeenCalledWith('cancelled-click');
  });
});
