import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

    // Mock fetch for Past tab API calls
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
  it('shows cancelled sessions in the Past tab', async () => {
    const cancelledSession = makeSession({
      sessionId: 'cancelled-1',
      status: 'cancelled',
      label: 'Cancelled Session',
    });

    const fleetState = makeFleetState([]);

    // Mock API responses for Past tab
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/fleet/filters')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statuses: ['completed', 'failed', 'cancelled'],
            workspaces: ['/home/user/project'],
            workflowNames: [],
          }),
        });
      }
      if (url.includes('/api/fleet/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sessions: [cancelledSession],
            total: 1,
            page: 1,
            limit: 20,
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<FleetMonitor fleetState={fleetState} onSessionClick={onSessionClick} />);

    // Switch to Past tab
    const pastButton = screen.getByRole('button', { name: /Past/i });
    fireEvent.click(pastButton);

    // Wait for the API call and rendering
    await waitFor(() => {
      expect(screen.getByTestId('session-card-cancelled-1')).toBeInTheDocument();
    });
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
  it('includes cancelled sessions in the Past button count', async () => {
    const cancelledSession = makeSession({
      sessionId: 'cancelled-2',
      status: 'cancelled',
      label: 'Another Cancelled Session',
    });

    const fleetState = makeFleetState([]);

    // Mock API to return total: 1
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/fleet/filters')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statuses: ['completed', 'failed', 'cancelled'],
            workspaces: [],
            workflowNames: [],
          }),
        });
      }
      if (url.includes('/api/fleet/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sessions: [cancelledSession],
            total: 1,
            page: 1,
            limit: 20,
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<FleetMonitor fleetState={fleetState} onSessionClick={onSessionClick} />);

    // Switch to Past tab to trigger API call
    const pastButton = screen.getByRole('button', { name: /Past/i });
    fireEvent.click(pastButton);

    // Wait for the API call to complete and the count to update
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Past \(1\)/i })).toBeInTheDocument();
    });
  });

  // ── Baseline / non-regression tests ─────────────────────────────────────

  it('shows completed sessions in the Past tab', async () => {
    const completedSession = makeSession({
      sessionId: 'completed-1',
      status: 'completed',
      label: 'Completed Session',
    });

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/fleet/filters')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statuses: ['completed', 'failed', 'cancelled'],
            workspaces: [],
            workflowNames: [],
          }),
        });
      }
      if (url.includes('/api/fleet/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sessions: [completedSession],
            total: 1,
            page: 1,
            limit: 20,
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<FleetMonitor fleetState={makeFleetState([])} onSessionClick={onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    await waitFor(() => {
      expect(screen.getByTestId('session-card-completed-1')).toBeInTheDocument();
    });
  });

  it('shows failed sessions in the Past tab', async () => {
    const failedSession = makeSession({
      sessionId: 'failed-1',
      status: 'failed',
      label: 'Failed Session',
    });

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/fleet/filters')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statuses: ['completed', 'failed', 'cancelled'],
            workspaces: [],
            workflowNames: [],
          }),
        });
      }
      if (url.includes('/api/fleet/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sessions: [failedSession],
            total: 1,
            page: 1,
            limit: 20,
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<FleetMonitor fleetState={makeFleetState([])} onSessionClick={onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    await waitFor(() => {
      expect(screen.getByTestId('session-card-failed-1')).toBeInTheDocument();
    });
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

  it('pastCount reflects all three terminal statuses together', async () => {
    const sessions = [
      makeSession({ sessionId: 'c-1', status: 'completed', label: 'C1', startedAt: '2026-01-01T10:00:00.000Z' }),
      makeSession({ sessionId: 'f-1', status: 'failed', label: 'F1', startedAt: '2026-01-01T09:00:00.000Z' }),
      makeSession({ sessionId: 'x-1', status: 'cancelled', label: 'X1', startedAt: '2026-01-01T08:00:00.000Z' }),
    ];

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/fleet/filters')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statuses: ['completed', 'failed', 'cancelled'],
            workspaces: [],
            workflowNames: [],
          }),
        });
      }
      if (url.includes('/api/fleet/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sessions,
            total: 3,
            page: 1,
            limit: 20,
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<FleetMonitor fleetState={makeFleetState([])} onSessionClick={onSessionClick} />);

    // Switch to Past tab to trigger API call
    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    // All three terminal sessions must be counted → "Past (3)"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Past \(3\)/i })).toBeInTheDocument();
    });
  });

  it('shows empty state message when no past sessions exist', async () => {
    const runningSession = makeSession({ sessionId: 'running-2', status: 'running', label: 'Running' });

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/fleet/filters')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statuses: ['completed', 'failed', 'cancelled'],
            workspaces: [],
            workflowNames: [],
          }),
        });
      }
      if (url.includes('/api/fleet/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sessions: [],
            total: 0,
            page: 1,
            limit: 20,
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<FleetMonitor fleetState={makeFleetState([runningSession])} onSessionClick={onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    await waitFor(() => {
      expect(screen.getByText(/No sessions found/i)).toBeInTheDocument();
    });
  });

  it('calls onSessionClick with the session id when a card is clicked', async () => {
    const cancelledSession = makeSession({
      sessionId: 'cancelled-click',
      status: 'cancelled',
      label: 'Clickable Cancelled',
    });

    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/fleet/filters')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            statuses: ['completed', 'failed', 'cancelled'],
            workspaces: [],
            workflowNames: [],
          }),
        });
      }
      if (url.includes('/api/fleet/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sessions: [cancelledSession],
            total: 1,
            page: 1,
            limit: 20,
          }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<FleetMonitor fleetState={makeFleetState([])} onSessionClick={onSessionClick} />);

    fireEvent.click(screen.getByRole('button', { name: /Past/i }));

    await waitFor(() => {
      expect(screen.getByTestId('session-card-cancelled-click')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('session-card-cancelled-click'));

    expect(onSessionClick).toHaveBeenCalledTimes(1);
    expect(onSessionClick).toHaveBeenCalledWith('cancelled-click');
  });
});
