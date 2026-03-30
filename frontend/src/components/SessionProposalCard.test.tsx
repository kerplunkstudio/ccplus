import React from 'react';
import { render, screen } from '@testing-library/react';
import { SessionProposalCard } from './SessionProposalCard';

// CSS import is a no-op in Jest (handled by moduleNameMapper or identity-obj-proxy)
jest.mock('./SessionProposalCard.css', () => ({}), { virtual: true });

describe('SessionProposalCard', () => {
  const defaultProps = {
    sessionId: 'sess-abc-123',
    prompt: 'Refactor the auth module to use JWT tokens',
    workspace: '/Users/test/myproject',
    workflow: 'feature-dev',
  };

  it('renders "Session Started" header', () => {
    render(<SessionProposalCard {...defaultProps} />);
    expect(screen.getByText('Session Started')).toBeInTheDocument();
  });

  it('renders the session ID', () => {
    render(<SessionProposalCard {...defaultProps} />);
    expect(screen.getByText('sess-abc-123')).toBeInTheDocument();
  });

  it('renders the prompt text', () => {
    render(<SessionProposalCard {...defaultProps} />);
    expect(screen.getByText('Refactor the auth module to use JWT tokens')).toBeInTheDocument();
  });

  it('renders the workspace basename, not the full path', () => {
    render(<SessionProposalCard {...defaultProps} />);
    // Should show just the last segment of the path
    expect(screen.getByText('myproject')).toBeInTheDocument();
    // Full path should not appear as a visible text node
    expect(screen.queryByText('/Users/test/myproject')).not.toBeInTheDocument();
  });

  it('renders the workflow name', () => {
    render(<SessionProposalCard {...defaultProps} />);
    expect(screen.getByText('feature-dev')).toBeInTheDocument();
  });

  it('renders field labels', () => {
    render(<SessionProposalCard {...defaultProps} />);
    expect(screen.getByText('Session ID')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Workflow')).toBeInTheDocument();
    expect(screen.getByText('Task')).toBeInTheDocument();
  });

  it('uses the workspace path itself when it has no slashes', () => {
    render(
      <SessionProposalCard
        {...defaultProps}
        workspace="myworkspace"
      />
    );
    expect(screen.getByText('myworkspace')).toBeInTheDocument();
  });

  it('renders session ID in a code element', () => {
    render(<SessionProposalCard {...defaultProps} />);
    const codeEl = screen.getByText('sess-abc-123');
    expect(codeEl.tagName.toLowerCase()).toBe('code');
  });

  it('renders with "default" workflow', () => {
    render(
      <SessionProposalCard
        {...defaultProps}
        workflow="default"
      />
    );
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('renders a long prompt without truncation', () => {
    const longPrompt = 'A'.repeat(500);
    render(
      <SessionProposalCard
        {...defaultProps}
        prompt={longPrompt}
      />
    );
    expect(screen.getByText(longPrompt)).toBeInTheDocument();
  });

  it('renders the session-proposal-card container element', () => {
    const { container } = render(<SessionProposalCard {...defaultProps} />);
    expect(container.querySelector('.session-proposal-card')).not.toBeNull();
  });
});
