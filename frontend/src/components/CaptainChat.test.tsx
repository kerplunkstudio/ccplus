import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CaptainChat } from './CaptainChat';
import { Message } from '../types';

// scrollIntoView is not implemented in jsdom
window.HTMLElement.prototype.scrollIntoView = jest.fn();

// Mock sub-components to isolate CaptainChat logic
jest.mock('./MessageBubble', () => ({
  MessageBubble: ({ message, onLinkClick }: any) => (
    <div data-testid="message-bubble" data-role={message.role}>
      {message.content}
      {onLinkClick && (
        <button
          data-testid="mock-link"
          onClick={() => onLinkClick('https://example.com', 'Example')}
        >
          link
        </button>
      )}
    </div>
  ),
}));

jest.mock('./SessionProposalCard', () => ({
  SessionProposalCard: ({ sessionId, prompt, workspace, workflow }: any) => (
    <div
      data-testid="session-proposal-card"
      data-session-id={sessionId}
      data-prompt={prompt}
      data-workspace={workspace}
      data-workflow={workflow}
    >
      Session Started: {sessionId}
    </div>
  ),
}));

jest.mock('./InteractiveCard', () => ({
  InteractiveCard: ({ isSessionProposal }: any) => (
    <div
      data-testid="interactive-card"
      data-is-session-proposal={String(!!isSessionProposal)}
    />
  ),
}));

jest.mock('./ThinkingIndicator', () => ({
  ThinkingIndicator: () => <div data-testid="thinking-indicator" />,
}));

jest.mock('./ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

const defaultProps = {
  messages: [] as Message[],
  isStreaming: false,
  isThinking: false,
  isModelThinking: false,
  toolActivity: null,
  onSendMessage: jest.fn(),
  archivedConversations: [],
  onClearHistory: jest.fn(),
  onClear: jest.fn(),
  interactiveMessages: [],
  onRespondToInteractive: jest.fn(),
  onCancel: jest.fn(),
  contextPct: 0,
};

describe('CaptainChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('session_proposal message rendering', () => {
    it('renders SessionProposalCard when message type is session_proposal', () => {
      const proposalMessage: Message = {
        id: 'proposal_sess-abc_1700000000',
        role: 'assistant',
        content: '',
        timestamp: 1700000000000,
        streaming: false,
        type: 'session_proposal',
        sessionId: 'sess-abc-123',
        proposalPrompt: 'Refactor the auth module',
        proposalWorkspace: '/Users/test/myproject',
        proposalWorkflow: 'feature-dev',
      };

      render(<CaptainChat {...defaultProps} messages={[proposalMessage]} />);

      expect(screen.getByTestId('session-proposal-card')).toBeInTheDocument();
    });

    it('passes correct props to SessionProposalCard', () => {
      const proposalMessage: Message = {
        id: 'proposal_sess-xyz_1700000001',
        role: 'assistant',
        content: '',
        timestamp: 1700000001000,
        streaming: false,
        type: 'session_proposal',
        sessionId: 'sess-xyz-456',
        proposalPrompt: 'Build the login page',
        proposalWorkspace: '/home/user/webapp',
        proposalWorkflow: 'default',
      };

      render(<CaptainChat {...defaultProps} messages={[proposalMessage]} />);

      const card = screen.getByTestId('session-proposal-card');
      expect(card.getAttribute('data-session-id')).toBe('sess-xyz-456');
      expect(card.getAttribute('data-prompt')).toBe('Build the login page');
      expect(card.getAttribute('data-workspace')).toBe('/home/user/webapp');
      expect(card.getAttribute('data-workflow')).toBe('default');
    });

    it('does NOT render SessionProposalCard for regular assistant messages', () => {
      const regularMessage: Message = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Hello, I can help you with that.',
        timestamp: Date.now(),
        streaming: false,
      };

      render(<CaptainChat {...defaultProps} messages={[regularMessage]} />);

      expect(screen.queryByTestId('session-proposal-card')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-bubble')).toBeInTheDocument();
    });

    it('does NOT render SessionProposalCard for user messages', () => {
      const userMessage: Message = {
        id: 'user-msg-1',
        role: 'user',
        content: 'Start a session to fix the bug',
        timestamp: Date.now(),
      };

      render(<CaptainChat {...defaultProps} messages={[userMessage]} />);

      expect(screen.queryByTestId('session-proposal-card')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-bubble')).toBeInTheDocument();
    });

    it('renders SessionProposalCard alongside regular messages', () => {
      const messages: Message[] = [
        {
          id: 'user-msg-1',
          role: 'user',
          content: 'Start a session',
          timestamp: 1700000000000,
        },
        {
          id: 'assistant-msg-1',
          role: 'assistant',
          content: 'Starting your session now...',
          timestamp: 1700000001000,
        },
        {
          id: 'proposal-msg-1',
          role: 'assistant',
          content: '',
          timestamp: 1700000002000,
          streaming: false,
          type: 'session_proposal',
          sessionId: 'sess-new-1',
          proposalPrompt: 'Start a session',
          proposalWorkspace: '/home/user/project',
          proposalWorkflow: 'default',
        },
      ];

      render(<CaptainChat {...defaultProps} messages={messages} />);

      expect(screen.getAllByTestId('message-bubble')).toHaveLength(2);
      expect(screen.getByTestId('session-proposal-card')).toBeInTheDocument();
    });

    it('renders multiple SessionProposalCards when multiple proposals exist', () => {
      const messages: Message[] = [
        {
          id: 'proposal-1',
          role: 'assistant',
          content: '',
          timestamp: 1700000000000,
          streaming: false,
          type: 'session_proposal',
          sessionId: 'sess-1',
          proposalPrompt: 'Task one',
          proposalWorkspace: '/home/user/project1',
          proposalWorkflow: 'default',
        },
        {
          id: 'proposal-2',
          role: 'assistant',
          content: '',
          timestamp: 1700000001000,
          streaming: false,
          type: 'session_proposal',
          sessionId: 'sess-2',
          proposalPrompt: 'Task two',
          proposalWorkspace: '/home/user/project2',
          proposalWorkflow: 'feature-dev',
        },
      ];

      render(<CaptainChat {...defaultProps} messages={messages} />);

      expect(screen.getAllByTestId('session-proposal-card')).toHaveLength(2);
    });

    it('falls back to MessageBubble when session_proposal fields are incomplete (missing sessionId)', () => {
      // A message with type session_proposal but missing required fields should
      // fall through to MessageBubble rendering
      const incompleteProposal: Message = {
        id: 'incomplete-proposal',
        role: 'assistant',
        content: 'Fallback content',
        timestamp: Date.now(),
        streaming: false,
        type: 'session_proposal',
        // sessionId, proposalPrompt, proposalWorkspace, proposalWorkflow are missing
      };

      render(<CaptainChat {...defaultProps} messages={[incompleteProposal]} />);

      // Should not crash and should fall back to MessageBubble
      expect(screen.queryByTestId('session-proposal-card')).not.toBeInTheDocument();
      expect(screen.getByTestId('message-bubble')).toBeInTheDocument();
    });
  });

  describe('isSessionProposal prop on InteractiveCard', () => {
    it('passes isSessionProposal=true when interactive message has a sessionId', () => {
      const interactiveWithSession = {
        id: 'interactive-1',
        text: 'Approve this session?',
        actions: [
          { id: 'action-approve', label: 'Approve', style: 'primary' },
          { id: 'action-reject', label: 'Reject', style: 'danger' },
        ],
        responseState: 'pending' as const,
        selectedActionId: undefined,
        sessionId: 'sess-abc-123',
        createdAt: Date.now(),
      };

      render(
        <CaptainChat
          {...defaultProps}
          messages={[
            { id: 'msg-1', role: 'user', content: 'Start a session', timestamp: Date.now() - 1000 },
          ]}
          interactiveMessages={[interactiveWithSession]}
        />
      );

      const card = screen.getByTestId('interactive-card');
      expect(card.getAttribute('data-is-session-proposal')).toBe('true');
    });

    it('passes isSessionProposal=false when interactive message has no sessionId', () => {
      const interactiveNoSession = {
        id: 'interactive-2',
        text: 'Pick an option',
        actions: [
          { id: 'action-yes', label: 'Yes', style: 'primary' },
          { id: 'action-no', label: 'No', style: 'danger' },
        ],
        responseState: 'pending' as const,
        selectedActionId: undefined,
        createdAt: Date.now(),
      };

      render(
        <CaptainChat
          {...defaultProps}
          messages={[
            { id: 'msg-1', role: 'user', content: 'Choose something', timestamp: Date.now() - 1000 },
          ]}
          interactiveMessages={[interactiveNoSession]}
        />
      );

      const card = screen.getByTestId('interactive-card');
      expect(card.getAttribute('data-is-session-proposal')).toBe('false');
    });
  });

  describe('welcome screen', () => {
    it('shows welcome screen when no messages', () => {
      render(<CaptainChat {...defaultProps} messages={[]} />);
      expect(screen.getByText('Captain')).toBeInTheDocument();
    });

    it('does not show welcome screen when messages exist', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      ];

      render(<CaptainChat {...defaultProps} messages={messages} />);
      expect(screen.queryByText('Captain')).not.toBeInTheDocument();
    });
  });

  describe('onLinkClick propagation to MessageBubble (regression)', () => {
    const messageWithContent: Message = {
      id: 'msg-link-1',
      role: 'assistant',
      content: 'Check [this](https://example.com)',
      timestamp: Date.now(),
    };

    it('calls onLinkClick with URL when a link inside MessageBubble is clicked', () => {
      const onLinkClick = jest.fn();

      render(
        <CaptainChat
          {...defaultProps}
          messages={[messageWithContent]}
          onLinkClick={onLinkClick}
        />
      );

      fireEvent.click(screen.getByTestId('mock-link'));

      expect(onLinkClick).toHaveBeenCalledTimes(1);
      expect(onLinkClick).toHaveBeenCalledWith('https://example.com', 'Example');
    });

    it('does NOT call onLinkClick when the prop is not provided', () => {
      // Render without onLinkClick — the mock-link button must not appear because
      // the mock only renders it when onLinkClick is truthy.
      render(
        <CaptainChat
          {...defaultProps}
          messages={[messageWithContent]}
        />
      );

      expect(screen.queryByTestId('mock-link')).not.toBeInTheDocument();
    });

    it('passes onLinkClick to MessageBubble in archived conversation history', () => {
      const onLinkClick = jest.fn();
      const archivedConv = {
        id: 'conv-1',
        messages: [messageWithContent],
        startedAt: Date.now() - 10000,
        endedAt: Date.now() - 5000,
      };

      // Render with archive — show history first by having hasArchive=true and
      // a current message so the context bar History button is visible
      const currentMessage: Message = {
        id: 'current-msg',
        role: 'user',
        content: 'Current',
        timestamp: Date.now(),
      };

      render(
        <CaptainChat
          {...defaultProps}
          messages={[currentMessage]}
          archivedConversations={[archivedConv]}
          onLinkClick={onLinkClick}
        />
      );

      // Open history panel via the History button in the context bar
      fireEvent.click(screen.getByText('History'));

      // Expand the archived conversation
      fireEvent.click(screen.getByText(/Current/));

      // Now click the link inside the archived MessageBubble
      // (the first mock-link that appears in the expanded history)
      const links = screen.getAllByTestId('mock-link');
      fireEvent.click(links[0]);

      expect(onLinkClick).toHaveBeenCalledWith('https://example.com', 'Example');
    });
  });

  describe('Escape key cancellation', () => {
    it('calls onCancel when Escape is pressed while streaming', () => {
      const onCancel = jest.fn();
      render(<CaptainChat {...defaultProps} isStreaming={true} onCancel={onCancel} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onCancel when Escape is pressed while not streaming', () => {
      const onCancel = jest.fn();
      render(<CaptainChat {...defaultProps} isStreaming={false} onCancel={onCancel} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onCancel).not.toHaveBeenCalled();
    });

    it('does NOT call onCancel when other keys are pressed while streaming', () => {
      const onCancel = jest.fn();
      render(<CaptainChat {...defaultProps} isStreaming={true} onCancel={onCancel} />);

      fireEvent.keyDown(document, { key: 'Enter' });
      fireEvent.keyDown(document, { key: 'ArrowUp' });
      fireEvent.keyDown(document, { key: 'a' });

      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
