import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityTree } from './ActivityTree';
import { AgentNode, ToolNode, ActivityNode } from '../types';

describe('ActivityTree', () => {
  it('renders empty state when no tree nodes', () => {
    render(<ActivityTree tree={[]} />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('renders the Observability header', () => {
    render(<ActivityTree tree={[]} />);
    expect(screen.getByText('Observability')).toBeInTheDocument();
  });

  it('renders a tool node', () => {
    const tool: ToolNode = {
      tool_use_id: 'tool_1',
      tool_name: 'Read',
      timestamp: '2025-01-01T00:00:00Z',
      status: 'completed',
      duration_ms: 150,
      parent_agent_id: null,
    };
    render(<ActivityTree tree={[tool]} />);
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('150ms')).toBeInTheDocument();
  });

  it('renders an agent node with type', () => {
    const agent: AgentNode = {
      tool_use_id: 'agent_1',
      agent_type: 'code_agent',
      tool_name: 'dispatch_agent',
      timestamp: '2025-01-01T00:00:00Z',
      children: [],
      status: 'running',
    };
    render(<ActivityTree tree={[agent]} />);
    expect(screen.getByText('code_agent')).toBeInTheDocument();
  });

  it('renders nested children under agent', () => {
    const child: ToolNode = {
      tool_use_id: 'tool_2',
      tool_name: 'Write',
      timestamp: '2025-01-01T00:00:01Z',
      status: 'completed',
      duration_ms: 200,
      parent_agent_id: 'agent_1',
    };
    const agent: AgentNode = {
      tool_use_id: 'agent_1',
      agent_type: 'research',
      tool_name: 'dispatch_agent',
      timestamp: '2025-01-01T00:00:00Z',
      children: [child],
      status: 'running',
    };
    render(<ActivityTree tree={[agent]} />);
    expect(screen.getByText('research')).toBeInTheDocument();
    expect(screen.getByText('Write')).toBeInTheDocument();
  });

  it('collapses agent children when toggle button clicked', () => {
    const child: ToolNode = {
      tool_use_id: 'tool_3',
      tool_name: 'Bash',
      timestamp: '2025-01-01T00:00:01Z',
      status: 'completed',
      parent_agent_id: 'agent_2',
    };
    const agent: AgentNode = {
      tool_use_id: 'agent_2',
      agent_type: 'frontend',
      tool_name: 'dispatch',
      timestamp: '2025-01-01T00:00:00Z',
      children: [child],
      status: 'completed',
    };
    render(<ActivityTree tree={[agent]} />);
    // Initially expanded
    expect(screen.getByText('Bash')).toBeInTheDocument();
    // Click toggle button to collapse
    const toggleButton = screen.getByLabelText('Collapse children');
    fireEvent.click(toggleButton);
    expect(screen.queryByText('Bash')).not.toBeInTheDocument();
  });

  it('shows activity count badge', () => {
    const nodes: ActivityNode[] = [
      {
        tool_use_id: 't1',
        tool_name: 'Read',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'completed',
        parent_agent_id: null,
      } as ToolNode,
      {
        tool_use_id: 't2',
        tool_name: 'Write',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'running',
        parent_agent_id: null,
      } as ToolNode,
    ];
    render(<ActivityTree tree={nodes} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('formats duration in seconds', () => {
    const tool: ToolNode = {
      tool_use_id: 'tool_s',
      tool_name: 'Grep',
      timestamp: '2025-01-01T00:00:00Z',
      status: 'completed',
      duration_ms: 2500,
      parent_agent_id: null,
    };
    render(<ActivityTree tree={[tool]} />);
    expect(screen.getByText('2.5s')).toBeInTheDocument();
  });

  it('formats duration in minutes', () => {
    const tool: ToolNode = {
      tool_use_id: 'tool_m',
      tool_name: 'Build',
      timestamp: '2025-01-01T00:00:00Z',
      status: 'completed',
      duration_ms: 90000,
      parent_agent_id: null,
    };
    render(<ActivityTree tree={[tool]} />);
    expect(screen.getByText('1.5m')).toBeInTheDocument();
  });

  it('shows error for failed nodes', () => {
    const tool: ToolNode = {
      tool_use_id: 'tool_err',
      tool_name: 'Deploy',
      timestamp: '2025-01-01T00:00:00Z',
      status: 'failed',
      error: 'Permission denied',
      parent_agent_id: null,
    };
    render(<ActivityTree tree={[tool]} />);
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
  });

  it('renders status icons for different states', () => {
    const nodes: ActivityNode[] = [
      {
        tool_use_id: 'r',
        tool_name: 'Running',
        timestamp: '2025-01-01T00:00:00Z',
        status: 'running',
        parent_agent_id: null,
      } as ToolNode,
      {
        tool_use_id: 'c',
        tool_name: 'Done',
        timestamp: '2025-01-01T00:00:01Z',
        status: 'completed',
        parent_agent_id: null,
      } as ToolNode,
      {
        tool_use_id: 'f',
        tool_name: 'Broken',
        timestamp: '2025-01-01T00:00:02Z',
        status: 'failed',
        parent_agent_id: null,
      } as ToolNode,
    ];
    const { container } = render(<ActivityTree tree={nodes} />);
    expect(container.querySelector('.tool-status-running')).toBeInTheDocument();
    expect(container.querySelector('.tool-status-completed')).toBeInTheDocument();
    expect(container.querySelector('.tool-status-failed')).toBeInTheDocument();
  });

  it('opens detail panel when agent card clicked', () => {
    const agent: AgentNode = {
      tool_use_id: 'agent_1',
      agent_type: 'code_agent',
      tool_name: 'Agent',
      timestamp: '2025-01-01T00:00:00Z',
      children: [],
      status: 'completed',
    };
    render(<ActivityTree tree={[agent]} />);
    const agentCard = screen.getByText('code_agent').closest('.agent-card');
    fireEvent.click(agentCard!);
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('closes detail panel when back button clicked', () => {
    const agent: AgentNode = {
      tool_use_id: 'agent_1',
      agent_type: 'code_agent',
      tool_name: 'Agent',
      timestamp: '2025-01-01T00:00:00Z',
      children: [],
      status: 'completed',
    };
    render(<ActivityTree tree={[agent]} />);
    const agentCard = screen.getByText('code_agent').closest('.agent-card');
    fireEvent.click(agentCard!);
    const backButton = screen.getByText('Back');
    fireEvent.click(backButton);
    expect(screen.queryByText('Back')).not.toBeInTheDocument();
    expect(screen.getByText('code_agent')).toBeInTheDocument();
  });
});
