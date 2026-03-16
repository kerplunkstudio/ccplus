import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';
import { Message, UsageStats } from '../types';

// Mock sub-components that make fetch calls or have complex deps
jest.mock('./NewSessionDashboard', () => ({
  NewSessionDashboard: () => <div data-testid="new-session-dashboard">New session dashboard</div>,
}));

jest.mock('./ModelSelector', () => ({
  ModelSelector: ({ selectedModel, onSelectModel }: any) => (
    <select data-testid="model-selector" value={selectedModel} onChange={(e) => onSelectModel(e.target.value)}>
      <option value="claude-sonnet-4-20250514">Sonnet</option>
    </select>
  ),
}));

jest.mock('./PluginButton', () => ({
  PluginButton: () => null,
}));

jest.mock('./PluginModal', () => ({
  PluginModal: () => null,
}));

jest.mock('../hooks/useSkills', () => ({
  useSkills: () => ({ skills: [] }),
}));

jest.mock('../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

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
    toolLog: [] as any[],
    selectedModel: 'claude-sonnet-4-20250514',
    usageStats: mockUsageStats,
    onSendMessage: jest.fn(),
    onSelectModel: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders empty state when no messages', () => {
    render(<ChatPanel {...defaultProps} />);
    expect(screen.getByTestId('new-session-dashboard')).toBeInTheDocument();
  });

  it('renders the connection status indicator', () => {
    const { container } = render(<ChatPanel {...defaultProps} />);
    const status = container.querySelector('.connection-status');
    expect(status).toBeInTheDocument();
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
    const textarea = screen.getByPlaceholderText('Send a message or type / for commands...');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    const sendBtn = screen.getByLabelText('Send');
    fireEvent.click(sendBtn);
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith('Test message', undefined, undefined, undefined);
  });

  it('calls onSendMessage on Enter key', () => {
    render(<ChatPanel {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Send a message or type / for commands...');
    fireEvent.change(textarea, { target: { value: 'Enter test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith('Enter test', undefined, undefined, undefined);
  });

  it('does not send on Shift+Enter', () => {
    render(<ChatPanel {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Send a message or type / for commands...');
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
    const textarea = screen.getByPlaceholderText('Reconnecting — hang tight...');
    expect(textarea).toBeDisabled();
  });

  it('clears input after sending', () => {
    render(<ChatPanel {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Send a message or type / for commands...') as HTMLTextAreaElement;
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
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith('New message', undefined, undefined, undefined);
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

  it('adds drag-over class when files are dragged over input container', () => {
    const { container } = render(<ChatPanel {...defaultProps} />);
    const inputContainer = container.querySelector('.input-container');

    expect(inputContainer).not.toHaveClass('drag-over');

    fireEvent.dragOver(inputContainer!, {
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    expect(inputContainer).toHaveClass('drag-over');
  });

  it('removes drag-over class when files are dropped', () => {
    const { container } = render(<ChatPanel {...defaultProps} />);
    const inputContainer = container.querySelector('.input-container');

    fireEvent.dragOver(inputContainer!, {
      preventDefault: () => {},
      stopPropagation: () => {},
    });

    expect(inputContainer).toHaveClass('drag-over');

    // Drop event should reset drag-over state
    fireEvent.drop(inputContainer!, {
      preventDefault: () => {},
      stopPropagation: () => {},
      dataTransfer: { files: [] },
    });

    expect(inputContainer).not.toHaveClass('drag-over');
  });

  it('appends file paths to input when files are dropped', () => {
    const { container } = render(<ChatPanel {...defaultProps} />);
    const inputContainer = container.querySelector('.input-container');
    const textarea = screen.getByPlaceholderText(/Send a message/) as HTMLTextAreaElement;

    // Set initial value
    fireEvent.change(textarea, { target: { value: 'Here are my files:' } });

    // Create mock files with path property (Electron)
    const mockFiles = [
      { path: '/Users/test/file1.txt', name: 'file1.txt' },
      { path: '/Users/test/file2.js', name: 'file2.js' },
    ];

    fireEvent.drop(inputContainer!, {
      preventDefault: () => {},
      stopPropagation: () => {},
      dataTransfer: {
        files: mockFiles,
      },
    });

    expect(textarea.value).toContain('/Users/test/file1.txt');
    expect(textarea.value).toContain('/Users/test/file2.js');
    expect(textarea.value).toContain('Here are my files:');
  });

  it('handles drop with no files gracefully', () => {
    const { container } = render(<ChatPanel {...defaultProps} />);
    const inputContainer = container.querySelector('.input-container');
    const textarea = screen.getByPlaceholderText(/Send a message/) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'Original text' } });

    fireEvent.drop(inputContainer!, {
      preventDefault: () => {},
      stopPropagation: () => {},
      dataTransfer: {
        files: [],
      },
    });

    expect(textarea.value).toBe('Original text');
  });

  it('preserves input drafts across session switches', () => {
    const { rerender } = render(<ChatPanel {...defaultProps} sessionId="session1" />);
    const textarea = screen.getByPlaceholderText(/Send a message/) as HTMLTextAreaElement;

    // Type in session1
    fireEvent.change(textarea, { target: { value: 'Draft for session 1' } });

    // Switch to session2
    rerender(<ChatPanel {...defaultProps} sessionId="session2" />);
    expect(textarea.value).toBe('');

    // Type in session2
    fireEvent.change(textarea, { target: { value: 'Draft for session 2' } });

    // Switch back to session1
    rerender(<ChatPanel {...defaultProps} sessionId="session1" />);
    expect(textarea.value).toBe('Draft for session 1');

    // Switch back to session2
    rerender(<ChatPanel {...defaultProps} sessionId="session2" />);
    expect(textarea.value).toBe('Draft for session 2');
  });

  it('caps input drafts at 50 sessions to prevent memory leak', () => {
    const { rerender } = render(<ChatPanel {...defaultProps} sessionId="session_0" />);
    const textarea = screen.getByPlaceholderText(/Send a message/) as HTMLTextAreaElement;

    // Create 60 session switches with drafts
    // For each i, we type "Draft ${i}" in session_i, then switch to session_${i+1}
    for (let i = 0; i < 60; i++) {
      fireEvent.change(textarea, { target: { value: `Draft ${i}` } });
      rerender(<ChatPanel {...defaultProps} sessionId={`session_${i + 1}`} />);
    }

    // After the loop, we've saved drafts for session_0 through session_59
    // The draft map should be capped at 50 entries
    // The first 10 drafts (session_0 through session_9) should be evicted

    // Switch back to session_9 (which should be evicted)
    rerender(<ChatPanel {...defaultProps} sessionId="session_9" />);
    expect(textarea.value).toBe(''); // Draft was cleaned up

    // Switch to session_50 (should still have draft "Draft 50")
    rerender(<ChatPanel {...defaultProps} sessionId="session_50" />);
    expect(textarea.value).toBe('Draft 50'); // Draft preserved
  });
});
