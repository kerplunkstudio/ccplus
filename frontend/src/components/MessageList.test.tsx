import React from 'react';
import { render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import { Message, UsageStats } from '../types';

// JSDOM does not implement Element.scrollTo — mock it globally for this suite
beforeAll(() => {
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = jest.fn();
  }
});

// Mock child components that have complex deps
jest.mock('./NewSessionDashboard', () => ({
  NewSessionDashboard: () => <div data-testid="new-session-dashboard" />,
}));

jest.mock('./TextSelectionPopup', () => ({
  TextSelectionPopup: () => null,
}));

jest.mock('./ThinkingIndicator', () => ({
  ThinkingIndicator: () => <div data-testid="thinking-indicator" />,
}));

jest.mock('./QuestionPrompt', () => ({
  QuestionPrompt: () => <div data-testid="question-prompt" />,
}));

jest.mock('./TodoProgress', () => ({
  TodoProgress: () => <div data-testid="todo-progress" />,
}));

jest.mock('./MessageBubble', () => ({
  MessageBubble: ({ message }: any) => (
    <div data-testid="message-bubble" data-id={message.id}>
      {message.content}
    </div>
  ),
}));

const mockUsageStats: UsageStats = {
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalDuration: 0,
  queryCount: 0,
  contextWindowSize: 0,
  model: 'claude-sonnet-4-6',
  linesOfCode: 0,
  totalSessions: 0,
};

const makeMessage = (id: string, content = 'test'): Message => ({
  id,
  content,
  role: 'assistant',
  timestamp: Date.now(),
});

const defaultProps = {
  messages: [] as Message[],
  streaming: false,
  isRestoringSession: false,
  usageStats: mockUsageStats,
  pastSessions: [],
  toolLog: [],
};

describe('MessageList', () => {
  it('renders without crashing with no messages', () => {
    render(<MessageList {...defaultProps} />);
    expect(screen.getByTestId('new-session-dashboard')).toBeInTheDocument();
  });

  it('renders with role="log" for accessibility', () => {
    const { container } = render(<MessageList {...defaultProps} />);
    expect(container.querySelector('[role="log"]')).toBeInTheDocument();
  });

  it('renders aria-label on the messages container', () => {
    render(<MessageList {...defaultProps} />);
    expect(screen.getByRole('log', { name: 'Chat messages' })).toBeInTheDocument();
  });

  it('renders message bubbles for each message', () => {
    const messages = [makeMessage('1', 'hello'), makeMessage('2', 'world')];
    render(<MessageList {...defaultProps} messages={messages} />);
    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles).toHaveLength(2);
  });

  it('does not render new-session-dashboard when messages exist', () => {
    const messages = [makeMessage('1')];
    render(<MessageList {...defaultProps} messages={messages} />);
    expect(screen.queryByTestId('new-session-dashboard')).not.toBeInTheDocument();
  });

  it('does not render new-session-dashboard when restoring session', () => {
    render(<MessageList {...defaultProps} isRestoringSession={true} />);
    expect(screen.queryByTestId('new-session-dashboard')).not.toBeInTheDocument();
  });

  it('renders session-restore-loader when isRestoringSession is true', () => {
    const { container } = render(
      <MessageList {...defaultProps} isRestoringSession={true} />
    );
    expect(container.querySelector('.session-restore-loader')).toBeInTheDocument();
  });

  it('does not render session-restore-loader when not restoring', () => {
    const { container } = render(<MessageList {...defaultProps} />);
    expect(container.querySelector('.session-restore-loader')).not.toBeInTheDocument();
  });

  it('renders ThinkingIndicator when streaming is true', () => {
    render(<MessageList {...defaultProps} streaming={true} />);
    expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
  });

  it('does not render ThinkingIndicator when not streaming', () => {
    render(<MessageList {...defaultProps} streaming={false} />);
    expect(screen.queryByTestId('thinking-indicator')).not.toBeInTheDocument();
  });

  it('does not render ThinkingIndicator when streaming but restoring session', () => {
    render(
      <MessageList {...defaultProps} streaming={true} isRestoringSession={true} />
    );
    expect(screen.queryByTestId('thinking-indicator')).not.toBeInTheDocument();
  });

  it('renders QuestionPrompt when pendingQuestion and handler are provided', () => {
    const pendingQuestion = {
      questions: [
        {
          question: 'Continue?',
          header: 'Confirmation',
          options: [{ label: 'Yes', description: 'Proceed' }],
          multiSelect: false,
        },
      ],
      toolUseId: 'tool_1',
    };
    render(
      <MessageList
        {...defaultProps}
        pendingQuestion={pendingQuestion}
        onRespondToQuestion={jest.fn()}
      />
    );
    expect(screen.getByTestId('question-prompt')).toBeInTheDocument();
  });

  it('does not render QuestionPrompt without handler', () => {
    const pendingQuestion = {
      questions: [
        {
          question: 'Continue?',
          header: 'Confirmation',
          options: [],
          multiSelect: false,
        },
      ],
      toolUseId: 'tool_1',
    };
    render(<MessageList {...defaultProps} pendingQuestion={pendingQuestion} />);
    expect(screen.queryByTestId('question-prompt')).not.toBeInTheDocument();
  });

  it('renders TodoProgress when todos are present and handler provided', () => {
    const todos = [
      { id: '1', content: 'Do something', status: 'pending' as const, priority: 'medium' as const },
    ];
    render(
      <MessageList {...defaultProps} todos={todos} onClearTodos={jest.fn()} />
    );
    expect(screen.getByTestId('todo-progress')).toBeInTheDocument();
  });

  it('does not render TodoProgress without todos', () => {
    render(<MessageList {...defaultProps} todos={[]} onClearTodos={jest.fn()} />);
    expect(screen.queryByTestId('todo-progress')).not.toBeInTheDocument();
  });

  it('renders the CSS scroll anchor element', () => {
    const { container } = render(<MessageList {...defaultProps} />);
    expect(container.querySelector('.scroll-anchor')).toBeInTheDocument();
  });

  it('renders scroll-anchor with aria-hidden', () => {
    const { container } = render(<MessageList {...defaultProps} />);
    const anchor = container.querySelector('.scroll-anchor');
    expect(anchor).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders scroll-to-bottom button (initially hidden)', () => {
    render(<MessageList {...defaultProps} />);
    const btn = screen.getByRole('button', { name: 'Scroll to latest message' });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveClass('visible');
  });

  it('scroll-to-bottom button is not tabbable when hidden', () => {
    render(<MessageList {...defaultProps} />);
    const btn = screen.getByRole('button', { name: 'Scroll to latest message' });
    expect(btn).toHaveAttribute('tabIndex', '-1');
  });

  it('messages container has correct ARIA attributes', () => {
    render(<MessageList {...defaultProps} />);
    const container = screen.getByRole('log');
    expect(container).toHaveAttribute('aria-live', 'polite');
  });

  it('renders messages with correct keys by message id', () => {
    const messages = [makeMessage('abc', 'first'), makeMessage('xyz', 'second')];
    render(<MessageList {...defaultProps} messages={messages} />);
    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles[0]).toHaveAttribute('data-id', 'abc');
    expect(bubbles[1]).toHaveAttribute('data-id', 'xyz');
  });

  it('calls onLoadSession when provided to NewSessionDashboard', () => {
    // NewSessionDashboard is mocked, so we just verify it receives the prop without errors
    const onLoadSession = jest.fn();
    render(<MessageList {...defaultProps} onLoadSession={onLoadSession} />);
    expect(screen.getByTestId('new-session-dashboard')).toBeInTheDocument();
  });

  it('handles empty todos array gracefully', () => {
    render(<MessageList {...defaultProps} todos={[]} />);
    expect(screen.queryByTestId('todo-progress')).not.toBeInTheDocument();
  });

  it('handles undefined todos gracefully (uses default)', () => {
    render(<MessageList {...defaultProps} />);
    expect(screen.queryByTestId('todo-progress')).not.toBeInTheDocument();
  });

  describe('C2: Submitted indicator', () => {
    it('renders submitted indicator when sessionStatus is submitted', () => {
      render(<MessageList {...defaultProps} sessionStatus="submitted" />);
      expect(screen.getByRole('status', { name: 'Processing message' })).toBeInTheDocument();
    });

    it('does not render submitted indicator when sessionStatus is idle', () => {
      render(<MessageList {...defaultProps} sessionStatus="idle" />);
      expect(screen.queryByRole('status', { name: 'Processing message' })).not.toBeInTheDocument();
    });

    it('does not render submitted indicator when sessionStatus is streaming', () => {
      render(<MessageList {...defaultProps} sessionStatus="streaming" streaming={true} />);
      expect(screen.queryByRole('status', { name: 'Processing message' })).not.toBeInTheDocument();
    });

    it('does not render submitted indicator when sessionStatus is not provided (default idle)', () => {
      render(<MessageList {...defaultProps} />);
      expect(screen.queryByRole('status', { name: 'Processing message' })).not.toBeInTheDocument();
    });

    it('does not render submitted indicator when restoring session even if submitted', () => {
      render(<MessageList {...defaultProps} sessionStatus="submitted" isRestoringSession={true} />);
      expect(screen.queryByRole('status', { name: 'Processing message' })).not.toBeInTheDocument();
    });

    it('renders ThinkingIndicator when sessionStatus is streaming', () => {
      render(<MessageList {...defaultProps} sessionStatus="streaming" streaming={true} />);
      expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
    });

    it('does not render submitted indicator when sessionStatus is complete', () => {
      render(<MessageList {...defaultProps} sessionStatus="complete" />);
      expect(screen.queryByRole('status', { name: 'Processing message' })).not.toBeInTheDocument();
    });
  });
});
