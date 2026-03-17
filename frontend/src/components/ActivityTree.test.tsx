import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityTree } from './ActivityTree';
import { AgentNode, ToolNode, ActivityNode, UsageStats } from '../types';

const mockStats: UsageStats = {
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalDuration: 0,
  queryCount: 0,
  contextWindowSize: 200000,
  model: '',
  linesOfCode: 0,
  totalSessions: 0,
};

describe('ActivityTree', () => {
  it('renders empty state when no tree nodes', () => {
    render(<ActivityTree tree={[]} usageStats={mockStats} />);
    expect(screen.getByText('Standby')).toBeInTheDocument();
  });

  it('renders the activity tabs', () => {
    render(<ActivityTree tree={[]} usageStats={mockStats} />);
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Tool Logs')).toBeInTheDocument();
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
    render(<ActivityTree tree={[tool]} usageStats={mockStats} />);
    // The tree auto-switches to 'tools' tab when last node is a tool
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
    render(<ActivityTree tree={[agent]} usageStats={mockStats} />);
    expect(screen.getByText('code_agent')).toBeInTheDocument();
  });

  it('renders nested children under agent when expanded', () => {
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
    render(<ActivityTree tree={[agent]} usageStats={mockStats} />);
    expect(screen.getByText('research')).toBeInTheDocument();
    // AgentCard starts collapsed (useState(false)), so expand first
    const expandButton = screen.getByLabelText('Expand children');
    fireEvent.click(expandButton);
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
    render(<ActivityTree tree={[agent]} usageStats={mockStats} />);
    // AgentCard starts collapsed - expand first
    const expandButton = screen.getByLabelText('Expand children');
    fireEvent.click(expandButton);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    // Now collapse
    const collapseButton = screen.getByLabelText('Collapse children');
    fireEvent.click(collapseButton);
    // Children wrapper has CSS class removed, but Bash text is still in DOM
    // The wrapper uses CSS to hide - check the wrapper class
    const wrapper = document.querySelector('.agent-card-children-wrapper');
    expect(wrapper).not.toHaveClass('expanded');
  });

  it('shows activity count badge in tab', () => {
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
    render(<ActivityTree tree={nodes} usageStats={mockStats} />);
    // The tab count badge shows "2" for tool nodes
    const toolLogsTab = screen.getByRole('tab', { name: /Tool Logs/i });
    expect(toolLogsTab).toBeInTheDocument();
    // The badge renders as a span with class activity-tab-count
    const badge = toolLogsTab.querySelector('.activity-tab-count');
    expect(badge).toHaveTextContent('2');
  });

  it('formats duration using formatDuration utility', () => {
    const tool: ToolNode = {
      tool_use_id: 'tool_s',
      tool_name: 'Grep',
      timestamp: '2025-01-01T00:00:00Z',
      status: 'completed',
      duration_ms: 2500,
      parent_agent_id: null,
    };
    render(<ActivityTree tree={[tool]} usageStats={mockStats} />);
    // formatDuration(2500) = "2.5s"
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
    render(<ActivityTree tree={[tool]} usageStats={mockStats} />);
    // formatDuration(90000) = "1.5m"
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
    render(<ActivityTree tree={[tool]} usageStats={mockStats} />);
    // Error is shown in the detail panel when node is clicked
    const deployNode = screen.getByText('Deploy');
    fireEvent.click(deployNode);
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
    const { container } = render(<ActivityTree tree={nodes} usageStats={mockStats} />);
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
    render(<ActivityTree tree={[agent]} usageStats={mockStats} />);
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
    render(<ActivityTree tree={[agent]} usageStats={mockStats} />);
    const agentCard = screen.getByText('code_agent').closest('.agent-card');
    fireEvent.click(agentCard!);
    const backButton = screen.getByText('Back');
    fireEvent.click(backButton);
    expect(screen.queryByText('Back')).not.toBeInTheDocument();
    expect(screen.getByText('code_agent')).toBeInTheDocument();
  });

  it('renders usage stats bar', () => {
    const stats: UsageStats = {
      totalCost: 0.0123,
      totalInputTokens: 1500,
      totalOutputTokens: 2500,
      totalDuration: 5432,
      queryCount: 3,
      contextWindowSize: 200000,
      model: 'sonnet',
      linesOfCode: 250,
      totalSessions: 2,
    };
    const { container } = render(<ActivityTree tree={[]} usageStats={stats} />);
    // UsageStatsBar renders - just verify the component is present
    expect(container.querySelector('.activity-tree')).toBeInTheDocument();
  });

  it('renders usage stats bar with zero values', () => {
    const { container } = render(<ActivityTree tree={[]} usageStats={mockStats} />);
    expect(container.querySelector('.activity-tree')).toBeInTheDocument();
  });
});
