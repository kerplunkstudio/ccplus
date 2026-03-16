import { render, screen, fireEvent } from '@testing-library/react';
import { AgentCard } from './AgentCard';
import { AgentNode } from '../types';

describe('AgentCard', () => {
  const mockOnSelect = jest.fn();

  const baseNode: AgentNode = {
    tool_use_id: 'agent_123',
    agent_type: 'code_agent',
    tool_name: 'Agent',
    description: 'Test agent description',
    timestamp: new Date().toISOString(),
    children: [],
    status: 'completed',
    duration_ms: 1500,
  };

  beforeEach(() => {
    mockOnSelect.mockClear();
  });

  it('renders without crashing', () => {
    render(<AgentCard node={baseNode} depth={0} onSelect={mockOnSelect} />);
    expect(screen.getByText('Test agent description')).toBeInTheDocument();
  });

  it('shows truncated summary when collapsed', () => {
    const longSummary = 'This is a very long summary that should be truncated when collapsed because it exceeds the maximum length of 120 characters and we want to show only a preview to the user';
    const nodeWithSummary: AgentNode = {
      ...baseNode,
      summary: longSummary,
    };

    render(<AgentCard node={nodeWithSummary} depth={0} onSelect={mockOnSelect} />);

    // Should show truncated version with ellipsis
    const preview = screen.getByText(/This is a very long summary/);
    expect(preview).toBeInTheDocument();
    expect(preview.textContent).toContain('...');
    expect(preview.textContent!.length).toBeLessThan(longSummary.length);
  });

  it('shows full summary when expanded', () => {
    const longSummary = 'This is a very long summary that should be truncated when collapsed because it exceeds the maximum length of 120 characters and we want to show only a preview to the user';
    const nodeWithChildren: AgentNode = {
      ...baseNode,
      summary: longSummary,
      children: [
        {
          tool_use_id: 'tool_456',
          tool_name: 'Bash',
          timestamp: new Date().toISOString(),
          status: 'completed',
          parent_agent_id: 'agent_123',
        },
      ],
    };

    render(<AgentCard node={nodeWithChildren} depth={0} onSelect={mockOnSelect} />);

    // Initially shows truncated
    const truncated = screen.getByText(/This is a very long summary/);
    expect(truncated.textContent!.length).toBeLessThan(longSummary.length);

    // Expand
    const expandButton = screen.getByRole('button', { name: /Expand children/i });
    fireEvent.click(expandButton);

    // Should now show full summary
    const fullSummary = screen.getByText(longSummary);
    expect(fullSummary).toBeInTheDocument();
    expect(fullSummary.textContent).toBe(longSummary);
  });

  it('does not show summary when agent is running', () => {
    const runningNode: AgentNode = {
      ...baseNode,
      status: 'running',
      summary: 'This should not appear',
    };

    render(<AgentCard node={runningNode} depth={0} onSelect={mockOnSelect} />);

    expect(screen.queryByText('This should not appear')).not.toBeInTheDocument();
  });

  it('does not show summary when summary is null or empty', () => {
    const nodeWithoutSummary: AgentNode = {
      ...baseNode,
      summary: null,
    };

    render(<AgentCard node={nodeWithoutSummary} depth={0} onSelect={mockOnSelect} />);

    expect(screen.queryByText(/summary/i)).not.toBeInTheDocument();
  });

  it('handles short summaries without truncation', () => {
    const shortSummary = 'Short summary';
    const nodeWithShortSummary: AgentNode = {
      ...baseNode,
      summary: shortSummary,
    };

    render(<AgentCard node={nodeWithShortSummary} depth={0} onSelect={mockOnSelect} />);

    const summary = screen.getByText(shortSummary);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).toBe(shortSummary);
  });

  it('truncates at word boundary when possible', () => {
    const summary = 'This is a test summary with many words that should be truncated at a word boundary not in the middle of a word because this summary is intentionally very long and exceeds one hundred and twenty characters which is the default truncation limit';
    const nodeWithSummary: AgentNode = {
      ...baseNode,
      summary: summary,
    };

    render(<AgentCard node={nodeWithSummary} depth={0} onSelect={mockOnSelect} />);

    const truncated = screen.getByText(/This is a test summary/);
    // Should end with ellipsis and have been truncated
    expect(truncated.textContent).toContain('...');
    expect(truncated.textContent!.length).toBeLessThan(summary.length);
    // Should not cut in the middle of a word (no partial words before ...)
    const beforeEllipsis = truncated.textContent!.replace('...', '').trim();
    expect(beforeEllipsis).toMatch(/\S$/); // Should end with a non-whitespace char (complete word)
  });

  it('calls onSelect when card is clicked', () => {
    render(<AgentCard node={baseNode} depth={0} onSelect={mockOnSelect} />);

    const card = screen.getByRole('button', { name: /Test agent description/i });
    fireEvent.click(card);

    expect(mockOnSelect).toHaveBeenCalledWith(baseNode);
    expect(mockOnSelect).toHaveBeenCalledTimes(1);
  });
});
