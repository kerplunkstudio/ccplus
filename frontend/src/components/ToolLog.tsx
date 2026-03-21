import React from 'react';
import { ToolEvent } from '../types';
import { formatToolLabel, sanitizeBashCommand } from '../utils/formatToolLabel';
import './ToolLog.css';

interface ToolLogProps {
  events: ToolEvent[];
}

export const ToolLog: React.FC<ToolLogProps> = ({ events }) => {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="tool-log">
      {events.map((event) => (
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

  const renderToolLabel = (event: ToolEvent): React.ReactNode => {
    const params = event.parameters || {};

    if (event.tool_name === 'Bash') {
      const cmd = sanitizeBashCommand(String(params.command || ''));
      const truncated = cmd.slice(0, 50);
      const ellipsis = cmd.length > 50 ? '...' : '';

      // Split into first word (tool name) and rest
      const parts = truncated.split(/\s+/);
      const firstWord = parts[0] || '';
      const rest = parts.slice(1).join(' ');

      return (
        <>
          <strong className="tool-log-tool-name">{firstWord}</strong>
          {rest && ` ${rest}`}
          {ellipsis}
        </>
      );
    }

    // For non-Bash tools, format as: <strong>ToolName</strong> suffix
    const label = formatToolLabel(event);
    const toolName = event.tool_name;

    // Check if label starts with tool name (for Agent/Task, it may not)
    if (label.startsWith(toolName)) {
      const suffix = label.slice(toolName.length);
      return (
        <>
          <strong className="tool-log-tool-name">{toolName}</strong>
          {suffix}
        </>
      );
    }

    // For Agent/Task or other cases where label doesn't start with tool_name
    return <strong className="tool-log-tool-name">{label}</strong>;
  };

  return (
    <div className={className}>
      <span className="tool-log-arrow">
        {isRunning ? '⏵' : isCompleted ? '⏵' : '⏵'}
      </span>
      <span className="tool-log-label">
        {renderToolLabel(event)}
        {durationStr}
      </span>
    </div>
  );
};
