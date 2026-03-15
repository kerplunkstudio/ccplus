import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';
import { Message, UsageStats } from '../types';

describe('ChatPanel', () => {
  const mockUsageStats: UsageStats = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDuration: 0,
    queryCount: 0,
    contextWindowSize: 0,
    model: 'claude-sonnet-4-20250514',
    linesOfCode: 0,
    totalSessions: 0,
  };

  const defaultProps = {
    messages: [] as Message[],
    connected: true,
    streaming: false,
    backgroundProcessing: false,
    sessionId: 'test_session',
    toolLog: [],
    selectedProject: null as string | null,
    selectedModel: 'claude-sonnet-4-20250514',
    usageStats: mockUsageStats,
    onSendMessage: jest.fn(),
    onSelectProject: jest.fn(),
    onSelectModel: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders empty state when no messages', () => {
    render(<ChatPanel {...defaultProps} />);
    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
  });

  it('renders the header title', () => {
    render(<ChatPanel {...defaultProps} />);
    expect(screen.getByText('CC+')).toBeInTheDocument();
  });

  it('shows online connection status when connected', () => {
    const { container } = render(<ChatPanel {...defaultProps} />);
    const status = container.querySelector('.connection-status');
    expect(status).toHaveClass('online');
  });

  it('shows offline connection status when disconnected', () => {
    const { container } = render(<ChatPanel {...defaultProps} connected={false} />);
    const status = container.querySelector('.connection-status');
    expect(status).toHaveClass('offline');
  });

  it('renders messages when provided', () => {
    const messages: Message[] = [
      { id: '1', content: 'Hello', role: 'user', timestamp: Date.now() },
      { id: '2', content: 'World', role: 'assistant', timestamp: Date.now() },
    ];
    render(<ChatPanel {...defaultProps} messages={messages} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('calls onSendMessage when send button clicked', () => {
    render(<ChatPanel {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    const sendBtn = screen.getByLabelText('Send');
    fireEvent.click(sendBtn);
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith('Test message', undefined, 'claude-sonnet-4-20250514');
  });

  it('calls onSendMessage on Enter key', () => {
    render(<ChatPanel {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(textarea, { target: { value: 'Enter test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith('Enter test', undefined, 'claude-sonnet-4-20250514');
  });

  it('does not send on Shift+Enter', () => {
    render(<ChatPanel {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Send a message...');
    fireEvent.change(textarea, { target: { value: 'Multiline' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(defaultProps.onSendMessage).not.toHaveBeenCalled();
  });

  it('does not send empty messages', () => {
    render(<ChatPanel {...defaultProps} />);
    const sendBtn = screen.getByLabelText('Send');
    fireEvent.click(sendBtn);
    expect(defaultProps.onSendMessage).not.toHaveBeenCalled();
  });

  it('shows cancel button while streaming', () => {
    render(<ChatPanel {...defaultProps} streaming={true} />);
    expect(screen.getByLabelText('Cancel')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button clicked', () => {
    render(<ChatPanel {...defaultProps} streaming={true} />);
    const cancelBtn = screen.getByLabelText('Cancel');
    fireEvent.click(cancelBtn);
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('disables input when disconnected', () => {
    render(<ChatPanel {...defaultProps} connected={false} />);
    const textarea = screen.getByPlaceholderText('Connecting...');
    expect(textarea).toBeDisabled();
  });

  it('clears input after sending', () => {
    render(<ChatPanel {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Send a message...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'To be cleared' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(textarea.value).toBe('');
  });

  it('shows send button when background processing is active', () => {
    render(<ChatPanel {...defaultProps} streaming={false} backgroundProcessing={true} />);
    expect(screen.getByLabelText('Send')).toBeInTheDocument();
    expect(screen.queryByLabelText('Cancel')).not.toBeInTheDocument();
  });

  it('shows background processing indicator when backgroundProcessing is true', () => {
    render(<ChatPanel {...defaultProps} streaming={false} backgroundProcessing={true} />);
    expect(screen.getByText('Background agents running...')).toBeInTheDocument();
  });

  it('enables input when background processing is active', () => {
    render(<ChatPanel {...defaultProps} streaming={false} backgroundProcessing={true} />);
    const textarea = screen.getByPlaceholderText(/Send a message/);
    expect(textarea).not.toBeDisabled();
  });

  it('allows sending messages during background processing', () => {
    render(<ChatPanel {...defaultProps} streaming={false} backgroundProcessing={true} />);
    const textarea = screen.getByPlaceholderText(/Send a message/);
    fireEvent.change(textarea, { target: { value: 'New message' } });
    const sendBtn = screen.getByLabelText('Send');
    fireEvent.click(sendBtn);
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith('New message', undefined, 'claude-sonnet-4-20250514', undefined);
  });

  it('hides background processing indicator when streaming is active', () => {
    render(<ChatPanel {...defaultProps} streaming={true} backgroundProcessing={true} />);
    expect(screen.queryByText('Background agents running...')).not.toBeInTheDocument();
  });

  it('shows cancel button when actively streaming, even if backgroundProcessing was true', () => {
    render(<ChatPanel {...defaultProps} streaming={true} backgroundProcessing={false} />);
    expect(screen.getByLabelText('Cancel')).toBeInTheDocument();
    expect(screen.queryByLabelText('Send')).not.toBeInTheDocument();
  });
});
