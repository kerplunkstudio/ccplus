import React, { useState, useMemo, useCallback } from 'react';
import { FleetState } from '../types';
import { FleetSessionCard } from './FleetSessionCard';
import { useFleetSessions, useFleetFilters } from '../hooks/useFleetSessions';
import './FleetMonitor.css';

interface FleetMonitorProps {
  fleetState: FleetState;
  onSessionClick: (sessionId: string) => void;
}

type FilterType = 'active' | 'past';

export const FleetMonitor: React.FC<FleetMonitorProps> = ({ fleetState, onSessionClick }) => {
  const [filter, setFilter] = useState<FilterType>('active');

  // Past tab state
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch filters and past sessions (only when Past tab is active)
  const { filters } = useFleetFilters(filter === 'past');
  const {
    sessions: pastSessions,
    total: pastTotal,
    isLoading,
  } = useFleetSessions({
    status: selectedStatuses,
    workspace: selectedWorkspace || undefined,
    workflowName: selectedWorkflow || undefined,
    page: currentPage,
    limit: 20,
    enabled: filter === 'past',
  });

  // Active tab logic (from fleetState prop, unchanged)
  const activeSessions = useMemo(() => {
    const sessions = [...fleetState.sessions];
    const filtered = sessions.filter((s) => s.status === 'running' || s.status === 'idle');
    filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return filtered;
  }, [fleetState.sessions]);

  const activeCount = activeSessions.length;
  const pastCount = pastTotal;

  // Filter handlers
  const handleStatusToggle = useCallback((status: string) => {
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status);
      }
      return [...prev, status];
    });
    setCurrentPage(1);
  }, []);

  const handleWorkspaceChange = useCallback((workspace: string) => {
    setSelectedWorkspace(workspace);
    setCurrentPage(1);
  }, []);

  const handleWorkflowChange = useCallback((workflow: string) => {
    setSelectedWorkflow(workflow);
    setCurrentPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setSelectedStatuses([]);
    setSelectedWorkspace('');
    setSelectedWorkflow('');
    setCurrentPage(1);
  }, []);

  const activeFilterCount = [
    selectedStatuses.length > 0,
    selectedWorkspace !== '',
    selectedWorkflow !== '',
  ].filter(Boolean).length;

  const totalPages = Math.ceil(pastTotal / 20);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages, prev + 1));
  };

  return (
    <div className="fleet-monitor">
      <div className="fleet-filters">
        <button
          className={`fleet-filter-btn ${filter === 'active' ? 'active' : ''}`}
          onClick={() => {
            setFilter('active');
            handleClearFilters();
          }}
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

      {filter === 'past' && (
        <div className="fleet-past-controls">
          <div className="fleet-past-filters">
            <div className="fleet-filter-group">
              <label className="fleet-filter-label">Status</label>
              <div className="fleet-status-toggles">
                {['completed', 'failed', 'cancelled'].map((status) => (
                  <button
                    key={status}
                    className={`fleet-status-toggle ${selectedStatuses.includes(status) ? 'active' : ''}`}
                    onClick={() => handleStatusToggle(status)}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            <div className="fleet-filter-group">
              <label className="fleet-filter-label" htmlFor="workspace-filter">
                Project
              </label>
              <select
                id="workspace-filter"
                className="fleet-filter-select"
                value={selectedWorkspace}
                onChange={(e) => handleWorkspaceChange(e.target.value)}
              >
                <option value="">All projects</option>
                {filters?.workspaces.map((workspace) => (
                  <option key={workspace} value={workspace}>
                    {workspace.split('/').filter(Boolean).at(-1) || workspace}
                  </option>
                ))}
              </select>
            </div>

            <div className="fleet-filter-group">
              <label className="fleet-filter-label" htmlFor="workflow-filter">
                Workflow
              </label>
              <select
                id="workflow-filter"
                className="fleet-filter-select"
                value={selectedWorkflow}
                onChange={(e) => handleWorkflowChange(e.target.value)}
              >
                <option value="">All workflows</option>
                {filters?.workflowNames.map((workflow) => (
                  <option key={workflow} value={workflow}>
                    {workflow}
                  </option>
                ))}
              </select>
            </div>

            {activeFilterCount > 0 && (
              <button className="fleet-clear-filters" onClick={handleClearFilters}>
                Clear filters
                <span className="fleet-filter-badge">{activeFilterCount}</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="fleet-sessions">
        {filter === 'active' ? (
          activeSessions.length === 0 ? (
            <div className="fleet-empty-state">
              <div className="fleet-empty-rule" />
              <p className="fleet-empty-heading">No active sessions</p>
              <p className="fleet-empty-hint">
                Ask Captain to start a session —<br />
                refactor a module, fix a bug, explore the codebase.
              </p>
            </div>
          ) : (
            <div className="fleet-sessions-list">
              {activeSessions.map((session) => (
                <FleetSessionCard key={session.sessionId} session={session} onClick={onSessionClick} />
              ))}
            </div>
          )
        ) : (
          <>
            {isLoading ? (
              <div className="fleet-loading-state">
                <div className="fleet-loading-spinner" />
                <p className="fleet-loading-text">Loading sessions...</p>
              </div>
            ) : pastSessions.length === 0 ? (
              <div className="fleet-empty-state">
                <div className="fleet-empty-rule" />
                <p className="fleet-empty-heading">No sessions found</p>
                <p className="fleet-empty-hint">
                  {activeFilterCount > 0
                    ? 'Try adjusting your filters or clearing them.'
                    : 'Completed, failed, and cancelled sessions will appear here.'}
                </p>
              </div>
            ) : (
              <>
                <div className="fleet-sessions-list">
                  {pastSessions.map((session) => (
                    <FleetSessionCard key={session.sessionId} session={session} onClick={onSessionClick} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="fleet-pagination">
                    <button
                      className="fleet-page-btn"
                      onClick={handlePrevPage}
                      disabled={currentPage === 1}
                    >
                      ← Prev
                    </button>
                    <span className="fleet-page-info">
                      Page {currentPage} of {totalPages} ({pastTotal} sessions)
                    </span>
                    <button
                      className="fleet-page-btn"
                      onClick={handleNextPage}
                      disabled={currentPage === totalPages}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
