import { renderHook, waitFor, act } from '@testing-library/react';
import { useCaptainSocket } from './useCaptainSocket';
import { Socket } from 'socket.io-client';

jest.mock('socket.io-client');

describe('useCaptainSocket', () => {
  let mockSocket: {
    on: jest.Mock;
    off: jest.Mock;
    emit: jest.Mock;
    close: jest.Mock;
    io: { on: jest.Mock; off: jest.Mock };
  };


  beforeEach(() => {
    jest.clearAllMocks();
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
      io: { on: jest.fn(), off: jest.fn() },
    };

    // Mock fetch for captain session start
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ session_id: 'captain-session-123' }),
    });

    // Mock localStorage
    Storage.prototype.getItem = jest.fn((key: string) => {
      if (key === 'ccplus_captain_messages') return null;
      if (key === 'ccplus_captain_archive') return null;
      return null;
    });
    Storage.prototype.setItem = jest.fn();
    localStorage.clear();
  });

  describe('Socket listener lifecycle', () => {
    it('should register socket listeners on mount and clean up on unmount', async () => {
      const { unmount } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      // Wait for captain session to be initialized
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/captain/start'),
          expect.objectContaining({ method: 'POST' })
        );
      });

      // Wait for socket listeners to be registered
      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalledWith('captain_thinking', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('captain_text', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('captain_complete', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('captain_error', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('thinking_status', expect.any(Function));
      });

      // Unmount and verify cleanup
      unmount();

      expect(mockSocket.off).toHaveBeenCalledWith('captain_thinking', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('captain_text', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('captain_complete', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('captain_error', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('thinking_status', expect.any(Function));
    });
  });

  describe('Message persistence', () => {
    it('should retain captain messages from localStorage on remount', async () => {
      const existingMessages = [
        { id: 'user_1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { id: 'assistant_1', role: 'assistant', content: 'Hi there!', timestamp: Date.now(), streaming: false },
      ];

      // Pre-populate localStorage
      (Storage.prototype.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ccplus_captain_messages') return JSON.stringify(existingMessages);
        if (key === 'ccplus_captain_archive') return JSON.stringify([]);
        return null;
      });

      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      // Verify messages are loaded from localStorage
      expect(result.current.messages).toEqual(existingMessages);
    });
  });

  describe('Event loss regression test', () => {
    it('should lose captain events when component unmounts during thinking', async () => {
      // REGRESSION TEST: This test demonstrates the bug where events emitted by the server
      // during the unmount window (tab switch) are lost.
      //
      // Bug flow:
      // 1. User sends a message, Captain starts thinking (isThinking = true)
      // 2. User switches tabs -> hook unmounts -> socket.off() removes listeners
      // 3. Server emits captain_text and captain_complete events
      // 4. Events are lost because listeners were removed
      // 5. User switches back to Captain tab -> hook remounts
      // 6. Only the user message is in localStorage, assistant response is missing
      //
      // Expected behavior (after fix):
      // - Events should be buffered or socket should remain connected
      // - Messages should be in localStorage after remount

      const { result, unmount } = renderHook(
        ({ socket }) => useCaptainSocket(socket),
        { initialProps: { socket: mockSocket as unknown as Socket } }
      );

      // Wait for captain session to be initialized
      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      // Capture the socket event handlers before unmount
      const captainThinkingHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_thinking'
      )?.[1];
      const captainTextHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_text'
      )?.[1];
      const captainCompleteHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_complete'
      )?.[1];

      expect(captainThinkingHandler).toBeDefined();
      expect(captainTextHandler).toBeDefined();
      expect(captainCompleteHandler).toBeDefined();

      // Send a message to start streaming
      act(() => {
        result.current.sendMessage('Test question');
      });

      // Verify user message was added and isThinking is true
      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
        expect(result.current.messages[0].role).toBe('user');
        expect(result.current.messages[0].content).toBe('Test question');
        expect(result.current.isThinking).toBe(true);
      });

      // UNMOUNT the hook (simulating tab switch)
      unmount();

      // At this point, socket listeners are removed via socket.off()
      // Verify cleanup happened
      expect(mockSocket.off).toHaveBeenCalledWith('captain_thinking', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('captain_text', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('captain_complete', expect.any(Function));

      // Simulate the server sending events during the unmount window
      // These should be lost because the listeners were removed
      act(() => {
        if (captainTextHandler) {
          captainTextHandler({
            text: 'This is the assistant response that will be lost',
            message_index: 0,
          });
        }
        if (captainCompleteHandler) {
          captainCompleteHandler();
        }
      });

      // Update localStorage mock to return only the user message
      // (simulating what would be saved before unmount)
      const userMessageOnly = [
        { id: expect.stringContaining('user_'), role: 'user', content: 'Test question', timestamp: expect.any(Number) },
      ];
      (Storage.prototype.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ccplus_captain_messages') {
          // Only the user message was saved before unmount
          return JSON.stringify(userMessageOnly);
        }
        if (key === 'ccplus_captain_archive') return JSON.stringify([]);
        return null;
      });

      // REMOUNT the hook (simulating returning to Captain tab)
      const { result: remountedResult } = renderHook(() =>
        useCaptainSocket(mockSocket as unknown as Socket)
      );

      // Wait for session to reinitialize
      await waitFor(() => {
        expect(remountedResult.current.captainSessionId).toBe('captain-session-123');
      });

      // Verify messages are lost - only the user message is in localStorage
      // The assistant response that was emitted during unmount is gone
      expect(remountedResult.current.messages.length).toBe(1);
      expect(remountedResult.current.messages[0].role).toBe('user');
      expect(remountedResult.current.messages[0].content).toBe('Test question');

      // The assistant message is missing (this is the bug)
      const assistantMessages = remountedResult.current.messages.filter((m) => m.role === 'assistant');
      expect(assistantMessages.length).toBe(0);

      // isThinking should be false (no active state)
      expect(remountedResult.current.isThinking).toBe(false);
    });

    it('should handle multiple unmount/remount cycles gracefully', async () => {
      // Test that repeated tab switches don't cause state corruption

      let currentMessages = [
        { id: 'user_1', role: 'user', content: 'First message', timestamp: Date.now() },
      ];

      (Storage.prototype.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ccplus_captain_messages') return JSON.stringify(currentMessages);
        if (key === 'ccplus_captain_archive') return JSON.stringify([]);
        return null;
      });

      // First mount
      const { result: result1, unmount: unmount1 } = renderHook(() =>
        useCaptainSocket(mockSocket as unknown as Socket)
      );

      await waitFor(() => {
        expect(result1.current.captainSessionId).toBe('captain-session-123');
      });

      expect(result1.current.messages.length).toBe(1);
      unmount1();

      // Second mount
      const { result: result2, unmount: unmount2 } = renderHook(() =>
        useCaptainSocket(mockSocket as unknown as Socket)
      );

      await waitFor(() => {
        expect(result2.current.captainSessionId).toBe('captain-session-123');
      });

      expect(result2.current.messages.length).toBe(1);
      unmount2();

      // Third mount
      const { result: result3 } = renderHook(() =>
        useCaptainSocket(mockSocket as unknown as Socket)
      );

      await waitFor(() => {
        expect(result3.current.captainSessionId).toBe('captain-session-123');
      });

      expect(result3.current.messages.length).toBe(1);
      expect(result3.current.messages[0].content).toBe('First message');
    });
  });

  describe('Message streaming', () => {
    it('should handle captain_thinking event', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      const captainThinkingHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_thinking'
      )?.[1];

      expect(result.current.isThinking).toBe(false);

      act(() => {
        captainThinkingHandler?.({ thinking: 'Processing...' });
      });

      await waitFor(() => {
        expect(result.current.isThinking).toBe(true);
      });
    });

    it('should handle captain_text event', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      const captainTextHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_text'
      )?.[1];

      act(() => {
        captainTextHandler?.({ text: 'Hello from Captain', message_index: 0 });
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
        expect(result.current.messages[0].role).toBe('assistant');
        expect(result.current.messages[0].content).toBe('Hello from Captain');
        expect(result.current.isStreaming).toBe(true);
        expect(result.current.isThinking).toBe(false);
      });
    });

    it('should handle captain_complete event', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      const captainTextHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_text'
      )?.[1];
      const captainCompleteHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_complete'
      )?.[1];

      // First add a message
      act(() => {
        captainTextHandler?.({ text: 'Response text', message_index: 0 });
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
        expect(result.current.isStreaming).toBe(true);
      });

      // Then complete the stream
      act(() => {
        captainCompleteHandler?.();
      });

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(false);
        expect(result.current.isThinking).toBe(false);
        expect(result.current.messages[0].streaming).toBe(false);
      });
    });

    it('should handle captain_error event', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      const captainErrorHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_error'
      )?.[1];

      act(() => {
        captainErrorHandler?.({ message: 'Something went wrong' });
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
        expect(result.current.messages[0].role).toBe('assistant');
        expect(result.current.messages[0].content).toBe('Error: Something went wrong');
        expect(result.current.isStreaming).toBe(false);
        expect(result.current.isThinking).toBe(false);
      });
    });
  });

  describe('sendMessage', () => {
    it('should emit captain_message and add user message', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      act(() => {
        result.current.sendMessage('Hello Captain');
      });

      await waitFor(() => {
        expect(mockSocket.emit).toHaveBeenCalledWith('captain_message', { content: 'Hello Captain' });
        expect(result.current.messages.length).toBe(1);
        expect(result.current.messages[0].role).toBe('user');
        expect(result.current.messages[0].content).toBe('Hello Captain');
        expect(result.current.isStreaming).toBe(true);
        expect(result.current.isThinking).toBe(true);
      });
    });

    it('should not send empty messages', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      mockSocket.emit.mockClear();

      act(() => {
        result.current.sendMessage('   ');
      });

      await waitFor(() => {
        expect(mockSocket.emit).not.toHaveBeenCalledWith('captain_message', expect.anything());
      });
    });

    it('should handle /clear command', async () => {
      // Pre-populate with messages
      const existingMessages = [
        { id: 'user_1', role: 'user', content: 'Hello', timestamp: Date.now() - 1000 },
        { id: 'assistant_1', role: 'assistant', content: 'Hi!', timestamp: Date.now(), streaming: false },
      ];

      (Storage.prototype.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ccplus_captain_messages') return JSON.stringify(existingMessages);
        if (key === 'ccplus_captain_archive') return JSON.stringify([]);
        return null;
      });

      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.messages.length).toBe(2);
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      act(() => {
        result.current.sendMessage('/clear');
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(0);
      });

      expect(result.current.archivedConversations.length).toBe(1);
      expect(result.current.archivedConversations[0].messages).toEqual(existingMessages);

      // Should not emit captain_message for /clear
      expect(mockSocket.emit).not.toHaveBeenCalledWith('captain_message', expect.anything());
    });
  });

  describe('clearHistory', () => {
    it('should clear archived conversations', async () => {
      const archivedConversations = [
        {
          id: 'conv_1',
          messages: [
            { id: 'user_1', role: 'user', content: 'Old message', timestamp: Date.now() },
          ],
          startedAt: Date.now() - 10000,
          endedAt: Date.now(),
        },
      ];

      (Storage.prototype.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'ccplus_captain_messages') return JSON.stringify([]);
        if (key === 'ccplus_captain_archive') return JSON.stringify(archivedConversations);
        return null;
      });

      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.archivedConversations.length).toBe(1);
      });

      act(() => {
        result.current.clearHistory();
      });

      await waitFor(() => {
        expect(result.current.archivedConversations.length).toBe(0);
      });
    });
  });

  describe('session_proposal event', () => {
    it('registers a session_proposal socket listener on mount', async () => {
      renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalledWith('session_proposal', expect.any(Function));
      });
    });

    it('cleans up session_proposal listener on unmount', async () => {
      const { unmount } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalledWith('session_proposal', expect.any(Function));
      });

      unmount();

      expect(mockSocket.off).toHaveBeenCalledWith('session_proposal', expect.any(Function));
    });

    it('adds a message with type session_proposal when event is received', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      const sessionProposalHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'session_proposal'
      )?.[1];

      expect(sessionProposalHandler).toBeDefined();

      const proposalData = {
        sessionId: 'sess-abc-123',
        prompt: 'Refactor the auth module',
        workspace: '/Users/test/myproject',
        workflow: 'feature-dev',
        timestamp: 1700000000000,
      };

      act(() => {
        sessionProposalHandler(proposalData);
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
      });

      const msg = result.current.messages[0];
      expect(msg.type).toBe('session_proposal');
      expect(msg.role).toBe('assistant');
      expect(msg.sessionId).toBe('sess-abc-123');
      expect(msg.proposalPrompt).toBe('Refactor the auth module');
      expect(msg.proposalWorkspace).toBe('/Users/test/myproject');
      expect(msg.proposalWorkflow).toBe('feature-dev');
      expect(msg.timestamp).toBe(1700000000000);
    });

    it('proposal message id is unique and contains the sessionId', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      const sessionProposalHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'session_proposal'
      )?.[1];

      act(() => {
        sessionProposalHandler({
          sessionId: 'unique-sess-id',
          prompt: 'Fix bug',
          workspace: '/home/user/project',
          workflow: 'default',
          timestamp: Date.now(),
        });
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
      });

      expect(result.current.messages[0].id).toContain('unique-sess-id');
    });

    it('proposal message has streaming false', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      const sessionProposalHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'session_proposal'
      )?.[1];

      act(() => {
        sessionProposalHandler({
          sessionId: 'sess-xyz',
          prompt: 'Deploy to staging',
          workspace: '/home/user/project',
          workflow: 'deploy',
          timestamp: Date.now(),
        });
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
      });

      expect(result.current.messages[0].streaming).toBe(false);
    });

    it('appends multiple session_proposal messages without replacing existing messages', async () => {
      const { result } = renderHook(() => useCaptainSocket(mockSocket as unknown as Socket));

      await waitFor(() => {
        expect(result.current.captainSessionId).toBe('captain-session-123');
      });

      const captainTextHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'captain_text'
      )?.[1];

      const sessionProposalHandler = mockSocket.on.mock.calls.find(
        (call) => call[0] === 'session_proposal'
      )?.[1];

      // First add a regular assistant message
      act(() => {
        captainTextHandler({ text: 'Starting your session now', message_index: 0 });
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
      });

      // Then receive a session_proposal
      act(() => {
        sessionProposalHandler({
          sessionId: 'sess-new-1',
          prompt: 'Build feature X',
          workspace: '/home/user/project',
          workflow: 'default',
          timestamp: Date.now(),
        });
      });

      await waitFor(() => {
        expect(result.current.messages.length).toBe(2);
      });

      expect(result.current.messages[0].role).toBe('assistant');
      expect(result.current.messages[0].type).toBeUndefined();
      expect(result.current.messages[1].type).toBe('session_proposal');
    });
  });
});
