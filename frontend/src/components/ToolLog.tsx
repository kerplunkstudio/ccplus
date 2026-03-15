import React from 'react';
import { ToolEvent } from '../types';
import { formatToolLabel } from '../utils/formatToolLabel';
import './ToolLog.css';

interface ToolLogProps {
  events: ToolEvent[];
}

export const ToolLog: React.FC<ToolLogProps> = ({ events }) => {
  // Only show root-level tools (where parent_agent_id is null)
  const rootEvents = events.filter((event) => event.parent_agent_id === null);

  if (rootEvents.length === 0) {
    return null;
  }

  return (
    <div className="tool-log">
      {rootEvents.map((event) => (
        <ToolLogItem key={event.tool_use_id} event={event} />
      ))}
    </div>
  );
};

interface ToolLogItemProps {
  event: ToolEvent;
}

const ToolLogItem: React.FC<ToolLogItemProps> = ({ event }) => {
  const isRunning = event.type === 'tool_start' || event.type === 'agent_start';
  const isWorkerRestart = event.error === 'Worker restarted';
  const isFailed = (event.success === false || event.error != null) && !isWorkerRestart;
  const isCompleted = (event.type === 'tool_complete' || event.type === 'agent_stop') && !isFailed;

  let className = 'tool-log-item';
  if (isFailed) className += ' failed';

  const durationStr = event.duration_ms != null
    ? ` (${(event.duration_ms / 1000).toFixed(1)}s)`
    : '';

  return (
    <div className={className}>
      <span className="tool-log-arrow">
        {isRunning ? '⏵' : isCompleted ? '⏵' : '⏵'}
      </span>
      <span className="tool-log-label">
        {formatToolLabel(event)}
        {durationStr}
      </span>
      {isRunning && <span className="tool-log-pulse" />}
    </div>
  );
};
