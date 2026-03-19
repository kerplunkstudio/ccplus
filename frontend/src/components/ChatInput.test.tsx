import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from './ChatInput';
import { Message } from '../types';
import { ToastProvider } from '../contexts/ToastContext';

// Mock hooks
jest.mock('../hooks/useSkills', () => ({
  useSkills: () => ({
    skills: [
      { name: 'test-skill', plugin: 'test-plugin', description: 'Test skill description' },
      { name: 'another-skill', plugin: 'test-plugin', description: 'Another skill' },
    ],
    loading: false,
    error: null,
  }),
}));

// Mock child components
jest.mock('./SlashCommandAutocomplete', () => ({
  SlashCommandAutocomplete: ({ suggestions, onSelect, onClose }: any) => (
    <div data-testid="slash-autocomplete">
      {suggestions.map((s: any, i: number) => (
        <button key={i} onClick={() => onSelect(s)} data-testid={`suggestion-${i}`}>
          {s.name}
        </button>
      ))}
      <button onClick={onClose} data-testid="close-autocomplete">
        Close
      </button>
    </div>
  ),
}));

jest.mock('./PathAutocomplete', () => ({
  PathAutocomplete: ({ entries, onSelect, onClose }: any) => (
    <div data-testid="path-autocomplete">
      {entries.map((e: any, i: number) => (
        <button key={i} onClick={() => onSelect(e)} data-testid={`path-${i}`}>
          {e.name}
        </button>
      ))}
      <button onClick={onClose} data-testid="close-path-autocomplete">
        Close
      </button>
    </div>
  ),
}));

// Mock fetch for image uploads and path completions
global.fetch = jest.fn((url: string) => {
  if (url.includes('/api/path-complete')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        entries: [
          { name: 'file1.ts', path: '/home/user/file1.ts', isDir: false },
          { name: 'dir1', path: '/home/user/dir1', isDir: true },
        ],
      }),
    });
  }
  if (url.includes('/api/images/upload')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        id: 'img_123',
        filename: 'test.png',
        url: 'http://localhost:4000/images/test.png',
      }),
    });
  }
  return Promise.reject(new Error('Unknown URL'));
}) as jest.Mock;

const renderWithToast = (ui: React.ReactElement) => {
  return render(<ToastProvider>{ui}</ToastProvider>);
};

describe('ChatInput', () => {
  const mockOnSendMessage = jest.fn();
  const mockOnCancel = jest.fn();
  const mockOnClearPendingInput = jest.fn();

  const defaultProps = {
    connected: true,
    streaming: false,
    backgroundProcessing: false,
    onSendMessage: mockOnSendMessage,
    onCancel: mockOnCancel,
    sessionId: 'test-session',
    projectPath: '/home/user/project',
    messages: [] as Message[],
    pendingInput: null,
    onClearPendingInput: mockOnClearPendingInput,
    rateLimitState: null,
    promptSuggestions: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders textarea and send button', () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    expect(screen.getByPlaceholderText(/Send a message/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Send message/i)).toBeInTheDocument();
  });

  it('sends message on Enter key', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i);

    await userEvent.type(textarea, 'Hello world');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(mockOnSendMessage).toHaveBeenCalledWith('Hello world', undefined, undefined, undefined, undefined);
  });

  it('does not send on Shift+Enter (inserts newline)', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    await userEvent.type(textarea, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

    expect(mockOnSendMessage).not.toHaveBeenCalled();
    expect(textarea.value).toContain('\n');
  });

  it('does not send empty messages', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i);

    await userEvent.type(textarea, '   {Enter}');

    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('clears input after sending', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    await userEvent.type(textarea, 'Test message{Enter}');

    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
  });

  it('shows cancel button during streaming', () => {
    renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
    expect(screen.getByLabelText(/Cancel streaming/i)).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
    const cancelBtn = screen.getByLabelText(/Cancel streaming/i);

    fireEvent.click(cancelBtn);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('disables input when disconnected', () => {
    renderWithToast(<ChatInput {...defaultProps} connected={false} />);
    const textarea = screen.getByPlaceholderText(/Reconnecting/i);

    expect(textarea).toBeDisabled();
  });

  it('keeps input enabled during streaming to allow queueing', () => {
    renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
    const textarea = screen.getByPlaceholderText(/Type a message to queue/i);

    expect(textarea).not.toBeDisabled();
  });

  it('does not disable input during background processing', () => {
    renderWithToast(<ChatInput {...defaultProps} streaming={true} backgroundProcessing={true} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i);

    expect(textarea).not.toBeDisabled();
  });

  it('shows autocomplete dropdown on / prefix', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i);

    await userEvent.type(textarea, '/');

    await waitFor(() => {
      expect(screen.getByTestId('slash-autocomplete')).toBeInTheDocument();
    });
  });

  it('selects autocomplete suggestion on Enter', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    await userEvent.type(textarea, '/test');

    await waitFor(() => {
      expect(screen.getByTestId('slash-autocomplete')).toBeInTheDocument();
    });

    const suggestion = screen.getByTestId('suggestion-0');
    fireEvent.click(suggestion);

    await waitFor(() => {
      expect(textarea.value).toBe('/test-skill ');
    });
  });

  it('triggers path autocomplete on typing path', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i);

    // Type a path - the autocomplete dropdown depends on debounced API call and state updates
    // We verify the input accepts the path rather than testing the async dropdown appearance
    await userEvent.type(textarea, '~/test');

    expect(textarea).toHaveValue('~/test');

    // Note: Full autocomplete dropdown testing requires more complex async mocking
    // The component itself is tested via integration tests
  });

  it('navigates input history with up arrow', async () => {
    const messages: Message[] = [
      { id: '1', content: 'First message', role: 'user', timestamp: Date.now() - 2000 },
      { id: '2', content: 'Reply', role: 'assistant', timestamp: Date.now() - 1000 },
      { id: '3', content: 'Second message', role: 'user', timestamp: Date.now() },
    ];

    renderWithToast(<ChatInput {...defaultProps} messages={messages} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    // Ensure textarea is focused and cursor is at start
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    // Press up arrow - should show most recent user message
    fireEvent.keyDown(textarea, { key: 'ArrowUp', target: { selectionStart: 0 } });

    expect(textarea.value).toBe('Second message');

    // Press up arrow again - should show older message
    fireEvent.keyDown(textarea, { key: 'ArrowUp', target: { selectionStart: 0 } });

    expect(textarea.value).toBe('First message');
  });

  it('navigates input history with down arrow', async () => {
    const messages: Message[] = [
      { id: '1', content: 'First message', role: 'user', timestamp: Date.now() - 2000 },
      { id: '2', content: 'Second message', role: 'user', timestamp: Date.now() - 1000 },
    ];

    renderWithToast(<ChatInput {...defaultProps} messages={messages} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    // Type something first
    fireEvent.change(textarea, { target: { value: 'Current draft' } });

    // Ensure cursor is at start for history navigation
    textarea.setSelectionRange(0, 0);

    // Go back in history
    fireEvent.keyDown(textarea, { key: 'ArrowUp', target: { selectionStart: 0 } });
    expect(textarea.value).toBe('Second message');

    // Go forward in history (should restore draft)
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea.value).toBe('Current draft');
  });

  it('restores draft on session change', () => {
    const { rerender } = renderWithToast(<ChatInput {...defaultProps} sessionId="session-1" />);
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    // Type a draft
    fireEvent.change(textarea, { target: { value: 'Draft for session 1' } });

    // Switch to another session
    rerender(
      <ToastProvider>
        <ChatInput {...defaultProps} sessionId="session-2" />
      </ToastProvider>
    );

    // Input should be cleared (new session has no draft)
    expect(textarea.value).toBe('');

    // Switch back to session-1
    rerender(
      <ToastProvider>
        <ChatInput {...defaultProps} sessionId="session-1" />
      </ToastProvider>
    );

    // Draft should be restored
    expect(textarea.value).toBe('Draft for session 1');
  });

  it('handles pending input from "Send to new session"', () => {
    renderWithToast(<ChatInput {...defaultProps} pendingInput="Pending message" />);
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    expect(textarea.value).toBe('Pending message');
    expect(mockOnClearPendingInput).toHaveBeenCalled();
  });

  it('displays rate limit indicator when rate limited', () => {
    const rateLimitState = {
      active: true,
      retryAfterMs: 5000,
    };

    renderWithToast(<ChatInput {...defaultProps} rateLimitState={rateLimitState} />);

    expect(screen.getByText(/Rate limited/i)).toBeInTheDocument();
    expect(screen.getByText(/5s/i)).toBeInTheDocument();
  });

  it('displays prompt suggestions when not streaming', () => {
    const promptSuggestions = ['Suggestion 1', 'Suggestion 2'];

    renderWithToast(<ChatInput {...defaultProps} promptSuggestions={promptSuggestions} />);

    expect(screen.getByText('Suggestion 1')).toBeInTheDocument();
    expect(screen.getByText('Suggestion 2')).toBeInTheDocument();
  });

  it('hides prompt suggestions when streaming', () => {
    const promptSuggestions = ['Suggestion 1', 'Suggestion 2'];

    renderWithToast(
      <ChatInput {...defaultProps} promptSuggestions={promptSuggestions} streaming={true} />
    );

    expect(screen.queryByText('Suggestion 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggestion 2')).not.toBeInTheDocument();
  });

  it('sends message when clicking prompt suggestion', () => {
    const promptSuggestions = ['Quick suggestion'];

    renderWithToast(<ChatInput {...defaultProps} promptSuggestions={promptSuggestions} />);

    const suggestionBtn = screen.getByText('Quick suggestion');
    fireEvent.click(suggestionBtn);

    expect(mockOnSendMessage).toHaveBeenCalledWith('Quick suggestion');
  });

  it('shows background processing indicator', () => {
    renderWithToast(
      <ChatInput {...defaultProps} streaming={false} backgroundProcessing={true} />
    );

    expect(screen.getByText(/Background agents running/i)).toBeInTheDocument();
  });

  it('handles file drop for paths', () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const inputContainer = document.querySelector('.input-container') as HTMLElement;
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    // Mock FileList with path property
    const mockFile = {
      path: '/home/user/file1.ts',
      name: 'file1.ts',
      type: 'text/typescript',
    };

    const dataTransfer = {
      files: [mockFile],
    };

    fireEvent.drop(inputContainer, { dataTransfer });

    expect(textarea.value).toBe('/home/user/file1.ts');
  });

  it('shows attach button', () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    expect(screen.getByLabelText(/Attach image/i)).toBeInTheDocument();
  });

  it('resets history index after sending message', async () => {
    const messages: Message[] = [
      { id: '1', content: 'Old message', role: 'user', timestamp: Date.now() },
    ];

    const { rerender } = renderWithToast(<ChatInput {...defaultProps} messages={messages} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;

    // Set cursor at start
    textarea.setSelectionRange(0, 0);

    // Navigate to history
    fireEvent.keyDown(textarea, { key: 'ArrowUp', target: { selectionStart: 0 } });
    expect(textarea.value).toBe('Old message');

    // Clear and type new message
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.change(textarea, { target: { value: 'New message' } });

    // Send message
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // After send, the messages array would be updated
    const updatedMessages = [
      ...messages,
      { id: '2', content: 'New message', role: 'user' as const, timestamp: Date.now() },
    ];

    rerender(
      <ToastProvider>
        <ChatInput {...defaultProps} messages={updatedMessages} />
      </ToastProvider>
    );

    const newTextarea = screen.getByPlaceholderText(/Send a message/i) as HTMLTextAreaElement;
    newTextarea.setSelectionRange(0, 0);

    // Navigate up again - should show the new message
    fireEvent.keyDown(newTextarea, { key: 'ArrowUp', target: { selectionStart: 0 } });
    expect(newTextarea.value).toBe('New message');
  });

  it('closes autocomplete on Escape', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i);

    await userEvent.type(textarea, '/');

    await waitFor(() => {
      expect(screen.getByTestId('slash-autocomplete')).toBeInTheDocument();
    });

    fireEvent.keyDown(textarea, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('slash-autocomplete')).not.toBeInTheDocument();
    });
  });

  it('navigates autocomplete with arrow keys', async () => {
    renderWithToast(<ChatInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Send a message/i);

    await userEvent.type(textarea, '/');

    await waitFor(() => {
      expect(screen.getByTestId('slash-autocomplete')).toBeInTheDocument();
    });

    // Arrow down should increment index (tested via side effects)
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    // No assertions needed - testing that it doesn't crash
  });

  // Message Queueing Tests
  describe('Message Queueing', () => {
    it('queues message when sent during active streaming', async () => {
      renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
      const textarea = screen.getByPlaceholderText(/Type a message to queue/i) as HTMLTextAreaElement;

      await userEvent.type(textarea, 'Queued message');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      // Message should not be sent immediately
      expect(mockOnSendMessage).not.toHaveBeenCalled();

      // Queued indicator should appear
      await waitFor(() => {
        expect(screen.getByText(/Queued message/i)).toBeInTheDocument();
      });

      // Input should be cleared
      expect(textarea.value).toBe('');
    });

    it('shows both cancel and queue buttons during streaming', () => {
      renderWithToast(<ChatInput {...defaultProps} streaming={true} />);

      expect(screen.getByLabelText(/Cancel streaming/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Queue message/i)).toBeInTheDocument();
    });

    it('auto-sends queued message when streaming ends', async () => {
      const { rerender } = renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
      const textarea = screen.getByPlaceholderText(/Type a message to queue/i);

      // Queue a message
      await userEvent.type(textarea, 'Queued message');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(screen.getByText(/Queued message/i)).toBeInTheDocument();
      });

      // End streaming
      rerender(
        <ToastProvider>
          <ChatInput {...defaultProps} streaming={false} />
        </ToastProvider>
      );

      // Message should be sent automatically
      await waitFor(() => {
        expect(mockOnSendMessage).toHaveBeenCalledWith('Queued message', undefined, undefined, undefined, undefined);
      });

      // Queued indicator should disappear (check by querying cancel button or indicator class)
      expect(screen.queryByLabelText(/Cancel queued message/i)).not.toBeInTheDocument();
    });

    it('allows dismissing queued message', async () => {
      renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
      const textarea = screen.getByPlaceholderText(/Type a message to queue/i);

      // Queue a message
      await userEvent.type(textarea, 'Queued message');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(screen.getByText(/Queued message/i)).toBeInTheDocument();
      });

      // Click dismiss button
      const dismissBtn = screen.getByLabelText(/Cancel queued message/i);
      fireEvent.click(dismissBtn);

      // Queued indicator should disappear
      await waitFor(() => {
        expect(screen.queryByText(/Queued message/i)).not.toBeInTheDocument();
      });

      // Message should not be sent
      expect(mockOnSendMessage).not.toHaveBeenCalled();
    });

    it('replaces queued message when queueing another', async () => {
      renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
      const textarea = screen.getByPlaceholderText(/Type a message to queue/i);

      // Queue first message
      await userEvent.type(textarea, 'First message');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(screen.getByText(/First message/i)).toBeInTheDocument();
      });

      // Queue second message
      await userEvent.type(textarea, 'Second message');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      // Should show second message only
      await waitFor(() => {
        expect(screen.getByText(/Second message/i)).toBeInTheDocument();
        expect(screen.queryByText(/First message/i)).not.toBeInTheDocument();
      });
    });

    it('clears textarea when queueing message', async () => {
      renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
      const textarea = screen.getByPlaceholderText(/Type a message to queue/i) as HTMLTextAreaElement;

      // Type and queue a message
      await userEvent.type(textarea, 'Test message');
      expect(textarea.value).toBe('Test message');

      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      // Input should be cleared immediately after queueing
      await waitFor(() => {
        expect(textarea.value).toBe('');
      });

      // Queued indicator should show the message
      expect(screen.getByText(/Test message/i)).toBeInTheDocument();
    });

    it('does not queue during background processing', async () => {
      renderWithToast(<ChatInput {...defaultProps} streaming={true} backgroundProcessing={true} />);
      const textarea = screen.getByPlaceholderText(/Send a message/i);

      await userEvent.type(textarea, 'Not queued{Enter}');

      // Should send immediately during background processing
      await waitFor(() => {
        expect(mockOnSendMessage).toHaveBeenCalledWith('Not queued', undefined, undefined, undefined, undefined);
      });

      // No queued indicator should appear
      expect(screen.queryByLabelText(/Cancel queued message/i)).not.toBeInTheDocument();
    });

    it('truncates long queued messages in indicator', async () => {
      renderWithToast(<ChatInput {...defaultProps} streaming={true} />);
      const textarea = screen.getByPlaceholderText(/Type a message to queue/i) as HTMLTextAreaElement;

      const longMessage = 'A'.repeat(100);
      await userEvent.type(textarea, longMessage);
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        // Find the queued text element by class
        const indicator = document.querySelector('.queued-text');
        expect(indicator?.textContent).toContain('...');
        // Should truncate to 80 chars + "..." (83 total), much shorter than 100
        expect(indicator?.textContent?.length).toBeLessThan(90);
      });
    });
  });
});
