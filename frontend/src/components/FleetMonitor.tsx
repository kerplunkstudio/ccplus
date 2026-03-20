import React, { useState, useMemo } from 'react';
import { FleetState } from '../types';
import { FleetSessionCard } from './FleetSessionCard';
import './FleetMonitor.css';

interface FleetMonitorProps {
  fleetState: FleetState;
  onSessionClick: (sessionId: string) => void;
}

type FilterType = 'active' | 'past';

export const FleetMonitor: React.FC<FleetMonitorProps> = ({ fleetState, onSessionClick }) => {
  const [filter, setFilter] = useState<FilterType>('active');

  const filteredSessions = useMemo(() => {
    const sessions = [...fleetState.sessions];

    const filtered = filter === 'active'
      ? sessions.filter((s) => s.status === 'running' || s.status === 'idle')
      : sessions.filter((s) => s.status === 'completed' || s.status === 'failed');

    filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return filtered;
  }, [fleetState.sessions, filter]);

  const activeCount = fleetState.sessions.filter((s) => s.status === 'running' || s.status === 'idle').length;
  const pastCount = fleetState.sessions.filter((s) => s.status === 'completed' || s.status === 'failed').length;

  return (
    <div className="fleet-monitor">
      <div className="fleet-filters">
        <button
          className={`fleet-filter-btn ${filter === 'active' ? 'active' : ''}`}
          onClick={() => setFilter('active')}
        >
          Active{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        <button
          className={`fleet-filter-btn ${filter === 'past' ? 'active' : ''}`}
          onClick={() => setFilter('past')}
        >
          Past{pastCount > 0 ? ` (${pastCount})` : ''}
        </button>
      </div>

      <div className="fleet-sessions">
        {filteredSessions.length === 0 ? (
          <div className="fleet-empty-state">
            {filter === 'active' ? (
              <>
                <div className="fleet-empty-rule" />
                <p className="fleet-empty-heading">No active sessions</p>
                <p className="fleet-empty-hint">
                  Ask Captain to start a session —<br />
                  refactor a module, fix a bug, explore the codebase.
                </p>
              </>
            ) : (
              <>
                <div className="fleet-empty-rule" />
                <p className="fleet-empty-heading">No history yet</p>
                <p className="fleet-empty-hint">
                  Completed and failed sessions<br />
                  will appear here.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="fleet-sessions-list">
            {filteredSessions.map((session) => (
              <FleetSessionCard key={session.sessionId} session={session} onClick={onSessionClick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
