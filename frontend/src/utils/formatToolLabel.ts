import { ToolEvent } from '../types';

function basename(path: string): string {
  return path.split('/').pop() || path;
}

export function formatToolLabel(event: ToolEvent): string {
  const params = event.parameters || {};
  switch (event.tool_name) {
    case 'Read':
      return `Read ${basename(String(params.file_path || ''))}`;
    case 'Write':
      return `Write ${basename(String(params.file_path || ''))}`;
    case 'Edit':
      return `Edit ${basename(String(params.file_path || ''))}`;
    case 'Bash': {
      const cmd = String(params.command || '');
      return `Bash ${cmd.slice(0, 50)}${cmd.length > 50 ? '...' : ''}`;
    }
    case 'Glob':
      return `Glob ${String(params.pattern || '')}`;
    case 'Grep':
      return `Grep ${String(params.pattern || '')}`;
    case 'Agent':
    case 'Task':
      return event.agent_type || 'agent';
    default:
      return event.tool_name;
  }
}

export function formatToolLabelVerbose(event: ToolEvent): string {
  const params = event.parameters || {};
  switch (event.tool_name) {
    case 'Read':
      return `Reading ${basename(String(params.file_path || ''))}`;
    case 'Write':
      return `Writing ${basename(String(params.file_path || ''))}`;
    case 'Edit':
      return `Editing ${basename(String(params.file_path || ''))}`;
    case 'Bash':
      return `Running ${String(params.command || '').slice(0, 40)}`;
    case 'Glob':
      return `Searching ${String(params.pattern || '')}`;
    case 'Grep':
      return `Searching ${String(params.pattern || '')}`;
    case 'Agent':
    case 'Task':
      return `Using ${event.agent_type || 'agent'}`;
    default:
      return `Using ${event.tool_name}`;
  }
}
