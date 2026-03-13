import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';
import { Message } from '../types';

describe('ChatPanel', () => {
  const defaultProps = {
    messages: [] as Message[],
    connected: true,
    streaming: false,
    toolLog: [],
    selectedProject: null as string | null,
    selectedModel: 'claude-sonnet-4-20250514',
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

  it('shows online connection dot when connected', () => {
    const { container } = render(<ChatPanel {...defaultProps} />);
    const dot = container.querySelector('.connection-dot');
    expect(dot).toHaveClass('online');
  });

  it('shows offline connection dot when disconnected', () => {
    const { container } = render(<ChatPanel {...defaultProps} connected={false} />);
    const dot = container.querySelector('.connection-dot');
    expect(dot).toHaveClass('offline');
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
});
