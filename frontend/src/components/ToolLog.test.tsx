import React from 'react';
import { render, screen } from '@testing-library/react';
import { ToolLog } from './ToolLog';
import { ToolEvent } from '../types';

// Mock formatToolLabel utility
jest.mock('../utils/formatToolLabel', () => ({
  formatToolLabel: (event: ToolEvent) => {
    if (event.agent_type) {
      return `${event.tool_name}: ${event.agent_type}`;
    }
    return event.tool_name;
  },
  sanitizeBashCommand: (cmd: string) => cmd,
}));

describe('ToolLog', () => {
  const toolStartEvent: ToolEvent = {
    type: 'tool_start',
    tool_name: 'Bash',
    tool_use_id: 'tool_1',
    parent_agent_id: null,
    timestamp: '2025-01-15T10:00:00',
    parameters: { command: 'Bash' },
  };

  const toolCompleteEvent: ToolEvent = {
    type: 'tool_complete',
    tool_name: 'Bash',
    tool_use_id: 'tool_1',
    parent_agent_id: null,
    timestamp: '2025-01-15T10:00:05',
    success: true,
    duration_ms: 5000,
    parameters: { command: 'Bash' },
  };

  const toolFailedEvent: ToolEvent = {
    type: 'tool_complete',
    tool_name: 'Read',
    tool_use_id: 'tool_2',
    parent_agent_id: null,
    timestamp: '2025-01-15T10:01:00',
    success: false,
    error: 'File not found',
    duration_ms: 100,
  };

  const agentStartEvent: ToolEvent = {
    type: 'agent_start',
    tool_name: 'Agent',
    tool_use_id: 'agent_1',
    parent_agent_id: null,
    agent_type: 'code_agent',
    description: 'Writing tests',
    timestamp: '2025-01-15T10:02:00',
  };

  const agentStopEvent: ToolEvent = {
    type: 'agent_stop',
    tool_name: 'Agent',
    tool_use_id: 'agent_1',
    parent_agent_id: null,
    agent_type: 'code_agent',
    timestamp: '2025-01-15T10:02:30',
    success: true,
    duration_ms: 30000,
  };

  const nestedToolEvent: ToolEvent = {
    type: 'tool_start',
    tool_name: 'Edit',
    tool_use_id: 'tool_3',
    parent_agent_id: 'agent_1',
    timestamp: '2025-01-15T10:02:10',
  };

  const workerRestartEvent: ToolEvent = {
    type: 'tool_complete',
    tool_name: 'Bash',
    tool_use_id: 'tool_4',
    parent_agent_id: null,
    timestamp: '2025-01-15T10:03:00',
    success: false,
    error: 'Worker restarted',
    duration_ms: 1000,
  };

  describe('Rendering', () => {
    it('renders null when events array is empty', () => {
      const { container } = render(<ToolLog events={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders all events regardless of parent_agent_id', () => {
      const { container } = render(<ToolLog events={[nestedToolEvent]} />);
      expect(container.querySelector('.tool-log')).toBeInTheDocument();
      expect(container.querySelectorAll('.tool-log-item')).toHaveLength(1);
    });

    it('renders tool log container for root-level events', () => {
      const { container } = render(<ToolLog events={[toolStartEvent]} />);
      expect(container.querySelector('.tool-log')).toBeInTheDocument();
    });

    it('renders a tool log item', () => {
      const { container } = render(<ToolLog events={[toolStartEvent]} />);
      expect(container.querySelector('.tool-log-item')).toBeInTheDocument();
    });

    it('renders tool name using formatToolLabel', () => {
      render(<ToolLog events={[toolStartEvent]} />);
      expect(screen.getByText(/Bash/)).toBeInTheDocument();
    });

    it('renders agent type using formatToolLabel', () => {
      const { container } = render(<ToolLog events={[agentStartEvent]} />);
      const label = container.querySelector('.tool-log-label');
      expect(label?.textContent).toMatch(/Agent: code_agent/);
    });
  });

  describe('Event Filtering', () => {
    it('renders all events including nested ones', () => {
      const events = [toolStartEvent, nestedToolEvent];
      const { container } = render(<ToolLog events={events} />);
      const items = container.querySelectorAll('.tool-log-item');
      expect(items).toHaveLength(2);
    });

    it('renders all events including deeply nested tool events', () => {
      const events = [
        toolStartEvent,
        nestedToolEvent,
        { ...nestedToolEvent, tool_use_id: 'tool_5', parent_agent_id: 'agent_2' },
      ];
      const { container } = render(<ToolLog events={events} />);
      const items = container.querySelectorAll('.tool-log-item');
      expect(items).toHaveLength(3);
    });

    it('shows multiple root-level events', () => {
      const events = [toolStartEvent, toolCompleteEvent, agentStartEvent];
      const { container } = render(<ToolLog events={events} />);
      const items = container.querySelectorAll('.tool-log-item');
      expect(items).toHaveLength(3);
    });
  });

  describe('Event Status Display', () => {
    it('shows running status for tool_start', () => {
      const { container } = render(<ToolLog events={[toolStartEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).not.toHaveClass('failed');
    });

    it('shows running status for agent_start', () => {
      const { container } = render(<ToolLog events={[agentStartEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).not.toHaveClass('failed');
    });

    it('shows completed status for successful tool_complete', () => {
      const { container } = render(<ToolLog events={[toolCompleteEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).not.toHaveClass('failed');
    });

    it('shows completed status for successful agent_stop', () => {
      const { container } = render(<ToolLog events={[agentStopEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).not.toHaveClass('failed');
    });

    it('shows failed status for failed tool event', () => {
      const { container } = render(<ToolLog events={[toolFailedEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).toHaveClass('failed');
    });

    it('shows failed status when error is present', () => {
      const errorEvent: ToolEvent = {
        ...toolCompleteEvent,
        error: 'Something went wrong',
      };
      const { container } = render(<ToolLog events={[errorEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).toHaveClass('failed');
    });

    it('does not show failed status for worker restart', () => {
      const { container } = render(<ToolLog events={[workerRestartEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).not.toHaveClass('failed');
    });
  });

  describe('Duration Display', () => {
    it('shows duration for completed events', () => {
      render(<ToolLog events={[toolCompleteEvent]} />);
      expect(screen.getByText(/\(5\.0s\)/)).toBeInTheDocument();
    });

    it('shows duration in seconds with one decimal place', () => {
      const fastEvent: ToolEvent = {
        ...toolCompleteEvent,
        duration_ms: 1234,
      };
      render(<ToolLog events={[fastEvent]} />);
      expect(screen.getByText(/\(1\.2s\)/)).toBeInTheDocument();
    });

    it('does not show duration for running events', () => {
      const { container } = render(<ToolLog events={[toolStartEvent]} />);
      const label = container.querySelector('.tool-log-label');
      expect(label?.textContent).not.toMatch(/\(/);
    });

    it('does not show duration when duration_ms is null', () => {
      const noDurationEvent: ToolEvent = {
        ...toolCompleteEvent,
        duration_ms: undefined,
      };
      const { container } = render(<ToolLog events={[noDurationEvent]} />);
      const label = container.querySelector('.tool-log-label');
      expect(label?.textContent).not.toMatch(/\(/);
    });

    it('formats very short durations correctly', () => {
      const quickEvent: ToolEvent = {
        ...toolCompleteEvent,
        duration_ms: 50,
      };
      render(<ToolLog events={[quickEvent]} />);
      expect(screen.getByText(/\(0\.1s\)/)).toBeInTheDocument();
    });

    it('formats long durations correctly', () => {
      const longEvent: ToolEvent = {
        ...toolCompleteEvent,
        duration_ms: 123456,
      };
      render(<ToolLog events={[longEvent]} />);
      expect(screen.getByText(/\(123\.5s\)/)).toBeInTheDocument();
    });
  });

  describe('Visual Elements', () => {
    it('renders arrow icon for each item', () => {
      const { container } = render(<ToolLog events={[toolStartEvent]} />);
      const arrow = container.querySelector('.tool-log-arrow');
      expect(arrow).toBeInTheDocument();
      expect(arrow).toHaveTextContent('⏵');
    });

    it('renders label for each item', () => {
      const { container } = render(<ToolLog events={[toolStartEvent]} />);
      const label = container.querySelector('.tool-log-label');
      expect(label).toBeInTheDocument();
    });

    it('renders arrow for running events', () => {
      const { container } = render(<ToolLog events={[toolStartEvent]} />);
      const arrow = container.querySelector('.tool-log-arrow');
      expect(arrow).toHaveTextContent('⏵');
    });

    it('renders arrow for completed events', () => {
      const { container } = render(<ToolLog events={[toolCompleteEvent]} />);
      const arrow = container.querySelector('.tool-log-arrow');
      expect(arrow).toHaveTextContent('⏵');
    });

    it('renders arrow for failed events', () => {
      const { container } = render(<ToolLog events={[toolFailedEvent]} />);
      const arrow = container.querySelector('.tool-log-arrow');
      expect(arrow).toHaveTextContent('⏵');
    });
  });

  describe('Event Types', () => {
    it('handles tool_start events', () => {
      render(<ToolLog events={[toolStartEvent]} />);
      expect(screen.getByText(/Bash/)).toBeInTheDocument();
    });

    it('handles tool_complete events', () => {
      render(<ToolLog events={[toolCompleteEvent]} />);
      expect(screen.getByText(/Bash/)).toBeInTheDocument();
    });

    it('handles agent_start events', () => {
      const { container } = render(<ToolLog events={[agentStartEvent]} />);
      const label = container.querySelector('.tool-log-label');
      expect(label?.textContent).toMatch(/Agent: code_agent/);
    });

    it('handles agent_stop events', () => {
      const { container } = render(<ToolLog events={[agentStopEvent]} />);
      const label = container.querySelector('.tool-log-label');
      expect(label?.textContent).toMatch(/Agent: code_agent/);
    });

    it('handles mixed event types', () => {
      const events = [
        toolStartEvent,
        agentStartEvent,
        toolCompleteEvent,
        agentStopEvent,
      ];
      const { container } = render(<ToolLog events={events} />);
      const items = container.querySelectorAll('.tool-log-item');
      expect(items).toHaveLength(4);
    });
  });

  describe('Edge Cases', () => {
    it('handles event with no tool_name', () => {
      const noNameEvent: ToolEvent = {
        ...toolStartEvent,
        tool_name: '',
      };
      const { container } = render(<ToolLog events={[noNameEvent]} />);
      expect(container.querySelector('.tool-log-item')).toBeInTheDocument();
    });

    it('handles event with zero duration', () => {
      const zeroDurationEvent: ToolEvent = {
        ...toolCompleteEvent,
        duration_ms: 0,
      };
      render(<ToolLog events={[zeroDurationEvent]} />);
      expect(screen.getByText(/\(0\.0s\)/)).toBeInTheDocument();
    });

    it('handles success: true explicitly', () => {
      const { container } = render(<ToolLog events={[toolCompleteEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).not.toHaveClass('failed');
    });

    it('handles success: false explicitly', () => {
      const { container } = render(<ToolLog events={[toolFailedEvent]} />);
      const item = container.querySelector('.tool-log-item');
      expect(item).toHaveClass('failed');
    });

    it('handles event with empty error string', () => {
      const emptyErrorEvent: ToolEvent = {
        ...toolCompleteEvent,
        error: '',
      };
      const { container } = render(<ToolLog events={[emptyErrorEvent]} />);
      const item = container.querySelector('.tool-log-item');
      // Empty error string still counts as an error in the component logic
      expect(item).toHaveClass('failed');
    });

    it('renders correctly when events order changes', () => {
      const { rerender, container } = render(<ToolLog events={[toolStartEvent, agentStartEvent]} />);
      let items = container.querySelectorAll('.tool-log-item').length;
      expect(items).toBe(2);

      rerender(<ToolLog events={[agentStartEvent, toolStartEvent]} />);
      items = container.querySelectorAll('.tool-log-item').length;
      expect(items).toBe(2);
    });

    it('updates when new events are added', () => {
      const { rerender, container } = render(<ToolLog events={[toolStartEvent]} />);
      let items = container.querySelectorAll('.tool-log-item');
      expect(items).toHaveLength(1);

      rerender(<ToolLog events={[toolStartEvent, agentStartEvent]} />);
      items = container.querySelectorAll('.tool-log-item');
      expect(items).toHaveLength(2);
    });

    it('handles event with very long tool name', () => {
      const longNameEvent: ToolEvent = {
        ...toolStartEvent,
        tool_name: 'VeryLongToolNameThatShouldStillRenderCorrectly',
      };
      render(<ToolLog events={[longNameEvent]} />);
      expect(screen.getByText(/VeryLongToolNameThatShouldStillRenderCorrectly/)).toBeInTheDocument();
    });
  });
});
