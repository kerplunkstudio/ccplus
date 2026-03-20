import { streamReducer, initialStreamState, StreamState, StreamAction } from './streamReducer';
import { Message, ToolEvent } from '../types';

describe('streamReducer', () => {
  describe('TEXT_DELTA', () => {
    it('creates a new message when no active stream exists', () => {
      const action: StreamAction = {
        type: 'TEXT_DELTA',
        text: 'Hello',
        messageIndex: 0,
        seq: 1,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].role).toBe('assistant');
      expect(newState.messages[0].content).toBe('Hello');
      expect(newState.messages[0].streaming).toBe(true);
      expect(newState.streaming).toBe(true);
      expect(newState.backgroundProcessing).toBe(false);
      expect(newState.activeStreamId).toBe(newState.messages[0].id);
      expect(newState.streamingContent).toBe('Hello');
      expect(newState.lastSeq).toBe(1);
      expect(newState.messageIndex).toBe(0);
    });

    it('appends text to existing active stream', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Hello',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: 'Hello',
        streaming: true,
        lastSeq: 1,
        messageIndex: 0,
      };

      const action: StreamAction = {
        type: 'TEXT_DELTA',
        text: ' world',
        messageIndex: 0,
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].content).toBe('Hello world');
      expect(newState.streamingContent).toBe('Hello world');
      expect(newState.lastSeq).toBe(2);
    });

    it('finalizes current message and starts new when messageIndex changes', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'First message',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: 'First message',
        streaming: true,
        lastSeq: 1,
        messageIndex: 0,
      };

      const action: StreamAction = {
        type: 'TEXT_DELTA',
        text: 'Second message',
        messageIndex: 1,
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0].streaming).toBe(false);
      expect(newState.messages[0].content).toBe('First message');
      expect(newState.messages[1].streaming).toBe(true);
      expect(newState.messages[1].content).toBe('Second message');
      expect(newState.messageIndex).toBe(1);
    });

    it('deduplicates events with seq <= lastSeq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 5,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Hello',
            timestamp: Date.now(),
            streaming: false,
          },
        ],
      };

      const action: StreamAction = {
        type: 'TEXT_DELTA',
        text: 'Duplicate',
        messageIndex: 0,
        seq: 3,
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state); // No change
      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].content).toBe('Hello');
    });

    it('reuses last streaming assistant message when intermediateCompletion is false', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Partial',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        intermediateCompletion: false,
        lastSeq: 1,
      };

      const action: StreamAction = {
        type: 'TEXT_DELTA',
        text: 'New text',
        messageIndex: 0,
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(1); // Reused, not created new
      expect(newState.messages[0].id).toBe('msg_1');
      expect(newState.messages[0].content).toBe('New text');
      expect(newState.activeStreamId).toBe('msg_1');
    });

    it('creates new message when intermediateCompletion is true', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Completed',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        intermediateCompletion: true,
        lastSeq: 1,
      };

      const action: StreamAction = {
        type: 'TEXT_DELTA',
        text: 'New message',
        messageIndex: 0,
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[1].content).toBe('New message');
      expect(newState.intermediateCompletion).toBe(false);
    });
  });

  describe('RESPONSE_COMPLETE', () => {
    it('finalizes message on intermediate completion', () => {
      const toolLog: ToolEvent[] = [
        {
          id: 'tool_1',
          type: 'tool_call',
          name: 'test_tool',
          timestamp: Date.now(),
        } as ToolEvent,
      ];

      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Streaming...',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: 'Final content',
        streaming: true,
        lastSeq: 1,
      };

      const action: StreamAction = {
        type: 'RESPONSE_COMPLETE',
        data: {
          sdk_session_id: null, // Intermediate
          content: 'Response content',
        },
        toolLog,
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages[0].streaming).toBe(false);
      expect(newState.messages[0].content).toBe('Final content');
      expect(newState.messages[0].toolLog).toBe(toolLog);
      expect(newState.streaming).toBe(false);
      expect(newState.activeStreamId).toBeNull();
      expect(newState.streamingContent).toBe('');
      expect(newState.intermediateCompletion).toBe(true);
    });

    it('clears all state on final completion', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Final',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: 'Final',
        streaming: true,
        thinking: 'Some thinking',
        lastSeq: 1,
        messageIndex: 2,
      };

      const action: StreamAction = {
        type: 'RESPONSE_COMPLETE',
        data: {
          sdk_session_id: 'sdk_123', // Final
          content: 'Done',
        },
        toolLog: [],
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.streaming).toBe(false);
      expect(newState.backgroundProcessing).toBe(false);
      expect(newState.thinking).toBe('');
      expect(newState.activeStreamId).toBeNull();
      expect(newState.streamingContent).toBe('');
      expect(newState.messageIndex).toBe(0);
      expect(newState.intermediateCompletion).toBe(false);
    });

    it('deduplicates events with seq <= lastSeq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 5,
        streaming: true,
      };

      const action: StreamAction = {
        type: 'RESPONSE_COMPLETE',
        data: { sdk_session_id: 'sdk_123' },
        toolLog: [],
        seq: 3,
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
      expect(newState.streaming).toBe(true);
    });

    it('uses data.content when streamingContent is empty', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: '',
        lastSeq: 1,
      };

      const action: StreamAction = {
        type: 'RESPONSE_COMPLETE',
        data: {
          sdk_session_id: null,
          content: 'Fallback content',
        },
        toolLog: [],
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages[0].content).toBe('Fallback content');
    });
  });

  describe('STREAM_ACTIVE', () => {
    it('sets streaming to true', () => {
      const action: StreamAction = {
        type: 'STREAM_ACTIVE',
        seq: 1,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.streaming).toBe(true);
      expect(newState.lastSeq).toBe(1);
    });

    it('deduplicates events with seq <= lastSeq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 5,
        streaming: false,
      };

      const action: StreamAction = {
        type: 'STREAM_ACTIVE',
        seq: 4,
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
      expect(newState.streaming).toBe(false);
    });
  });

  describe('ERROR', () => {
    it('adds error message and clears streaming state', () => {
      const state: StreamState = {
        ...initialStreamState,
        streaming: true,
        backgroundProcessing: true,
        activeStreamId: 'msg_1',
        streamingContent: 'Partial',
        intermediateCompletion: true,
      };

      const action: StreamAction = {
        type: 'ERROR',
        message: 'Connection failed',
        seq: 1,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].role).toBe('assistant');
      expect(newState.messages[0].content).toBe('Error: Connection failed');
      expect(newState.messages[0].streaming).toBe(false);
      expect(newState.streaming).toBe(false);
      expect(newState.backgroundProcessing).toBe(false);
      expect(newState.activeStreamId).toBeNull();
      expect(newState.streamingContent).toBe('');
      expect(newState.intermediateCompletion).toBe(false);
    });

    it('deduplicates events with seq <= lastSeq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 5,
      };

      const action: StreamAction = {
        type: 'ERROR',
        message: 'Old error',
        seq: 3,
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
      expect(newState.messages).toHaveLength(0);
    });
  });

  describe('COMPACT_BOUNDARY', () => {
    it('adds compact boundary message', () => {
      const action: StreamAction = {
        type: 'COMPACT_BOUNDARY',
        seq: 1,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].content).toBe('↻ Context compacted');
      expect(newState.messages[0].role).toBe('assistant');
      expect(newState.messages[0].isCompactBoundary).toBe(true);
      expect(newState.lastSeq).toBe(1);
    });

    it('deduplicates events with seq <= lastSeq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 5,
      };

      const action: StreamAction = {
        type: 'COMPACT_BOUNDARY',
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
      expect(newState.messages).toHaveLength(0);
    });
  });

  describe('THINKING_DELTA', () => {
    it('accumulates thinking text', () => {
      const state: StreamState = {
        ...initialStreamState,
        thinking: 'Initial ',
      };

      const action: StreamAction = {
        type: 'THINKING_DELTA',
        text: 'thinking...',
      };

      const newState = streamReducer(state, action);

      expect(newState.thinking).toBe('Initial thinking...');
    });

    it('appends to empty thinking', () => {
      const action: StreamAction = {
        type: 'THINKING_DELTA',
        text: 'New thinking',
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.thinking).toBe('New thinking');
    });
  });

  describe('FINALIZE_STREAM', () => {
    it('finalizes active stream', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Old content',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: 'New content',
      };

      const action: StreamAction = {
        type: 'FINALIZE_STREAM',
      };

      const newState = streamReducer(state, action);

      expect(newState.messages[0].streaming).toBe(false);
      expect(newState.messages[0].content).toBe('New content');
      expect(newState.activeStreamId).toBeNull();
      expect(newState.streamingContent).toBe('');
    });

    it('does nothing when no active stream', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Content',
            timestamp: Date.now(),
            streaming: false,
          },
        ],
        activeStreamId: null,
        streamingContent: '',
      };

      const action: StreamAction = {
        type: 'FINALIZE_STREAM',
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
    });

    it('does nothing when streamingContent is empty', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Content',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: '',
      };

      const action: StreamAction = {
        type: 'FINALIZE_STREAM',
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
    });
  });

  describe('SEND_MESSAGE', () => {
    it('adds user message and clears streaming state', () => {
      const userMessage: Message = {
        id: 'user_1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };

      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Previous',
            timestamp: Date.now(),
            streaming: false,
          },
        ],
        activeStreamId: 'old_id',
        streamingContent: 'old content',
        messageIndex: 5,
        intermediateCompletion: true,
        thinking: 'old thinking',
      };

      const action: StreamAction = {
        type: 'SEND_MESSAGE',
        message: userMessage,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[1]).toBe(userMessage);
      expect(newState.streaming).toBe(true);
      expect(newState.activeStreamId).toBeNull();
      expect(newState.streamingContent).toBe('');
      expect(newState.messageIndex).toBe(0);
      expect(newState.intermediateCompletion).toBe(false);
      expect(newState.thinking).toBe('');
    });
  });

  describe('CANCEL_QUERY', () => {
    it('finalizes active stream and clears state', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Old',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: 'Cancelled content',
        streaming: true,
        backgroundProcessing: true,
        intermediateCompletion: true,
      };

      const action: StreamAction = {
        type: 'CANCEL_QUERY',
      };

      const newState = streamReducer(state, action);

      expect(newState.messages[0].streaming).toBe(false);
      expect(newState.messages[0].content).toBe('Cancelled content');
      expect(newState.streaming).toBe(false);
      expect(newState.backgroundProcessing).toBe(false);
      expect(newState.activeStreamId).toBeNull();
      expect(newState.streamingContent).toBe('');
      expect(newState.intermediateCompletion).toBe(false);
    });

    it('clears state when no active stream', () => {
      const state: StreamState = {
        ...initialStreamState,
        streaming: true,
        backgroundProcessing: true,
        intermediateCompletion: true,
      };

      const action: StreamAction = {
        type: 'CANCEL_QUERY',
      };

      const newState = streamReducer(state, action);

      expect(newState.streaming).toBe(false);
      expect(newState.backgroundProcessing).toBe(false);
      expect(newState.activeStreamId).toBeNull();
      expect(newState.streamingContent).toBe('');
      expect(newState.intermediateCompletion).toBe(false);
    });
  });

  describe('LOAD_HISTORY', () => {
    it('loads messages and marks last assistant message as streaming when active', () => {
      const messages: Message[] = [
        {
          id: 'msg_1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
        {
          id: 'msg_2',
          role: 'assistant',
          content: 'Hi there',
          timestamp: Date.now(),
          streaming: false,
        },
      ];

      const action: StreamAction = {
        type: 'LOAD_HISTORY',
        messages,
        isActive: true,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0].streaming).toBeUndefined();
      expect(newState.messages[1].streaming).toBe(true);
      expect(newState.streaming).toBe(true);
      expect(newState.activeStreamId).toBe('msg_2');
    });

    it('loads messages without marking as streaming when not active', () => {
      const messages: Message[] = [
        {
          id: 'msg_1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
        {
          id: 'msg_2',
          role: 'assistant',
          content: 'Hi there',
          timestamp: Date.now(),
        },
      ];

      const action: StreamAction = {
        type: 'LOAD_HISTORY',
        messages,
        isActive: false,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0]).toBe(messages[0]);
      expect(newState.messages[1]).toBe(messages[1]);
      expect(newState.streaming).toBe(false);
      expect(newState.activeStreamId).toBeNull();
    });

    it('handles empty history', () => {
      const action: StreamAction = {
        type: 'LOAD_HISTORY',
        messages: [],
        isActive: false,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.messages).toHaveLength(0);
      expect(newState.streaming).toBe(false);
    });
  });

  describe('CLEAR', () => {
    it('resets all state including lastSeq', () => {
      const state: StreamState = {
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Content',
            timestamp: Date.now(),
          },
        ],
        streaming: true,
        backgroundProcessing: true,
        thinking: 'Thinking...',
        lastSeq: 42,
        activeStreamId: 'msg_1',
        streamingContent: 'Streaming',
        messageIndex: 5,
        intermediateCompletion: true,
      };

      const action: StreamAction = {
        type: 'CLEAR',
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(0);
      expect(newState.streaming).toBe(false);
      expect(newState.backgroundProcessing).toBe(false);
      expect(newState.thinking).toBe('');
      expect(newState.lastSeq).toBe(0); // Reset to prevent cross-session contamination
      expect(newState.activeStreamId).toBeNull();
      expect(newState.streamingContent).toBe('');
      expect(newState.messageIndex).toBe(0);
      expect(newState.intermediateCompletion).toBe(false);
    });
  });

  describe('SET_STREAMING', () => {
    it('sets streaming to true', () => {
      const action: StreamAction = {
        type: 'SET_STREAMING',
        value: true,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.streaming).toBe(true);
    });

    it('sets streaming to false', () => {
      const state: StreamState = {
        ...initialStreamState,
        streaming: true,
      };

      const action: StreamAction = {
        type: 'SET_STREAMING',
        value: false,
      };

      const newState = streamReducer(state, action);

      expect(newState.streaming).toBe(false);
    });
  });

  describe('SET_BACKGROUND_PROCESSING', () => {
    it('sets backgroundProcessing to true', () => {
      const action: StreamAction = {
        type: 'SET_BACKGROUND_PROCESSING',
        value: true,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.backgroundProcessing).toBe(true);
    });

    it('sets backgroundProcessing to false', () => {
      const state: StreamState = {
        ...initialStreamState,
        backgroundProcessing: true,
      };

      const action: StreamAction = {
        type: 'SET_BACKGROUND_PROCESSING',
        value: false,
      };

      const newState = streamReducer(state, action);

      expect(newState.backgroundProcessing).toBe(false);
    });
  });

  describe('STREAM_CONTENT_SYNC', () => {
    it('creates new streaming message when no active stream', () => {
      const action: StreamAction = {
        type: 'STREAM_CONTENT_SYNC',
        content: 'Synced content',
        seq: 1,
      };

      const newState = streamReducer(initialStreamState, action);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].role).toBe('assistant');
      expect(newState.messages[0].content).toBe('Synced content');
      expect(newState.messages[0].streaming).toBe(true);
      expect(newState.streaming).toBe(true);
      expect(newState.activeStreamId).toBe(newState.messages[0].id);
      expect(newState.streamingContent).toBe('Synced content');
      expect(newState.lastSeq).toBe(1);
    });

    it('updates existing streaming message when activeStreamId exists', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Old content',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        activeStreamId: 'msg_1',
        streamingContent: 'Old content',
        streaming: true,
        lastSeq: 1,
      };

      const action: StreamAction = {
        type: 'STREAM_CONTENT_SYNC',
        content: 'Synced content',
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0].id).toBe('msg_1');
      expect(newState.messages[0].content).toBe('Synced content');
      expect(newState.streamingContent).toBe('Synced content');
      expect(newState.activeStreamId).toBe('msg_1');
      expect(newState.lastSeq).toBe(2);
    });

    it('reuses last assistant message from LOAD_HISTORY if streaming', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'user',
            content: 'Hello',
            timestamp: Date.now(),
          },
          {
            id: 'msg_2',
            role: 'assistant',
            content: 'Partial response',
            timestamp: Date.now(),
            streaming: true,
          },
        ],
        lastSeq: 1,
      };

      const action: StreamAction = {
        type: 'STREAM_CONTENT_SYNC',
        content: 'Synced content',
        seq: 2,
      };

      const newState = streamReducer(state, action);

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[1].id).toBe('msg_2');
      expect(newState.messages[1].content).toBe('Synced content');
      expect(newState.activeStreamId).toBe('msg_2');
      expect(newState.streamingContent).toBe('Synced content');
    });

    it('is a no-op when content is empty', () => {
      const state: StreamState = {
        ...initialStreamState,
        messages: [
          {
            id: 'msg_1',
            role: 'assistant',
            content: 'Existing',
            timestamp: Date.now(),
            streaming: false,
          },
        ],
        lastSeq: 5,
      };

      const action: StreamAction = {
        type: 'STREAM_CONTENT_SYNC',
        content: '',
        seq: 6,
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
      expect(newState.messages[0].content).toBe('Existing');
    });

    it('updates lastSeq when seq is higher', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 5,
      };

      const action: StreamAction = {
        type: 'STREAM_CONTENT_SYNC',
        content: 'Synced',
        seq: 10,
      };

      const newState = streamReducer(state, action);

      expect(newState.lastSeq).toBe(10);
    });

    it('preserves lastSeq when sync seq is lower', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 10,
      };

      const action: StreamAction = {
        type: 'STREAM_CONTENT_SYNC',
        content: 'Synced',
        seq: 5,
      };

      const newState = streamReducer(state, action);

      expect(newState.lastSeq).toBe(10);
    });
  });

  describe('Sequence deduplication', () => {
    it('ignores TEXT_DELTA with old seq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 10,
      };

      const action: StreamAction = {
        type: 'TEXT_DELTA',
        text: 'Old',
        messageIndex: 0,
        seq: 5,
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
    });

    it('ignores RESPONSE_COMPLETE with old seq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 10,
      };

      const action: StreamAction = {
        type: 'RESPONSE_COMPLETE',
        data: {},
        toolLog: [],
        seq: 8,
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
    });

    it('ignores STREAM_ACTIVE with old seq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 10,
      };

      const action: StreamAction = {
        type: 'STREAM_ACTIVE',
        seq: 10, // Equal to lastSeq
      };

      const newState = streamReducer(state, action);

      expect(newState).toBe(state);
    });

    it('processes events with seq > lastSeq', () => {
      const state: StreamState = {
        ...initialStreamState,
        lastSeq: 5,
      };

      const action: StreamAction = {
        type: 'TEXT_DELTA',
        text: 'New',
        messageIndex: 0,
        seq: 6,
      };

      const newState = streamReducer(state, action);

      expect(newState).not.toBe(state);
      expect(newState.lastSeq).toBe(6);
    });
  });

  describe('Cross-session lastSeq contamination (regression)', () => {
    // This suite tests the fix for the bug where switching sessions caused
    // new session events to be silently dropped by the dedup check because
    // lastSeq from the old session was preserved across CLEAR/LOAD_HISTORY.

    it('CLEAR then STREAM_ACTIVE: events from new session are not dropped', () => {
      // Simulate: old session had accumulated lastSeq=100
      const oldSessionState: StreamState = {
        ...initialStreamState,
        messages: [
          { id: 'old_msg', role: 'assistant', content: 'old', timestamp: Date.now(), streaming: false },
        ],
        lastSeq: 100,
        streaming: false,
      };

      // Tab switch triggers CLEAR
      const clearedState = streamReducer(oldSessionState, { type: 'CLEAR' });
      expect(clearedState.lastSeq).toBe(0);

      // New session's stream_active arrives with a low seq (new session has few events)
      const afterStreamActive = streamReducer(clearedState, { type: 'STREAM_ACTIVE', seq: 3 });
      expect(afterStreamActive.streaming).toBe(true);
      expect(afterStreamActive.lastSeq).toBe(3);
    });

    it('CLEAR then TEXT_DELTA: streaming resumes in new session', () => {
      const oldSessionState: StreamState = {
        ...initialStreamState,
        lastSeq: 200,
        streaming: false,
      };

      // Tab switch
      const clearedState = streamReducer(oldSessionState, { type: 'CLEAR' });

      // New session text_delta with low seq
      const afterDelta = streamReducer(clearedState, {
        type: 'TEXT_DELTA',
        text: 'Hello from new session',
        messageIndex: 0,
        seq: 1,
      });

      expect(afterDelta.messages).toHaveLength(1);
      expect(afterDelta.messages[0].content).toBe('Hello from new session');
      expect(afterDelta.streaming).toBe(true);
      expect(afterDelta.lastSeq).toBe(1);
    });

    it('CLEAR then RESPONSE_COMPLETE: completion from new session is not dropped', () => {
      const oldSessionState: StreamState = {
        ...initialStreamState,
        lastSeq: 150,
      };

      const clearedState = streamReducer(oldSessionState, { type: 'CLEAR' });

      const afterComplete = streamReducer(clearedState, {
        type: 'RESPONSE_COMPLETE',
        data: { sdk_session_id: 'sdk_new', content: 'Done' },
        toolLog: [],
        seq: 5,
      });

      expect(afterComplete).not.toBe(clearedState);
      expect(afterComplete.streaming).toBe(false);
      expect(afterComplete.lastSeq).toBe(5);
    });

    it('LOAD_HISTORY resets lastSeq so subsequent events are accepted', () => {
      // Start with stale lastSeq from old session
      const staleState: StreamState = {
        ...initialStreamState,
        lastSeq: 500,
      };

      const messages: Message[] = [
        { id: 'db_1', role: 'user', content: 'Hi', timestamp: Date.now() },
        { id: 'db_2', role: 'assistant', content: 'Hello', timestamp: Date.now() },
      ];

      // LOAD_HISTORY from new session (not active)
      const afterLoad = streamReducer(staleState, {
        type: 'LOAD_HISTORY',
        messages,
        isActive: false,
      });

      expect(afterLoad.lastSeq).toBe(0);

      // Now a text_delta with low seq should work
      const afterDelta = streamReducer(afterLoad, {
        type: 'TEXT_DELTA',
        text: 'New content',
        messageIndex: 0,
        seq: 2,
      });

      expect(afterDelta.messages).toHaveLength(3);
      expect(afterDelta.lastSeq).toBe(2);
    });

    it('LOAD_HISTORY with active streaming resets lastSeq', () => {
      const staleState: StreamState = {
        ...initialStreamState,
        lastSeq: 300,
      };

      const messages: Message[] = [
        { id: 'db_1', role: 'user', content: 'Hi', timestamp: Date.now() },
        { id: 'db_2', role: 'assistant', content: 'Partial', timestamp: Date.now() },
      ];

      // LOAD_HISTORY with active streaming and streaming content
      const afterLoad = streamReducer(staleState, {
        type: 'LOAD_HISTORY',
        messages,
        isActive: true,
        streamingContent: 'Buffered response...',
      });

      expect(afterLoad.lastSeq).toBe(0);
      expect(afterLoad.streaming).toBe(true);

      // stream_active from server arrives with low seq — should NOT be dropped
      const afterActive = streamReducer(afterLoad, { type: 'STREAM_ACTIVE', seq: 5 });
      expect(afterActive.streaming).toBe(true);
      expect(afterActive.lastSeq).toBe(5);
    });

    it('full tab switch flow: CLEAR -> LOAD_HISTORY -> stream_active -> text_delta', () => {
      // Simulate a complete tab switch with an actively streaming new session

      // Step 1: Old session state with high lastSeq
      const oldState: StreamState = {
        ...initialStreamState,
        messages: [
          { id: 'old_1', role: 'assistant', content: 'old response', timestamp: Date.now(), streaming: false },
        ],
        lastSeq: 1000,
        streaming: false,
      };

      // Step 2: CLEAR on tab switch
      const afterClear = streamReducer(oldState, { type: 'CLEAR' });
      expect(afterClear.lastSeq).toBe(0);
      expect(afterClear.messages).toHaveLength(0);

      // Step 3: LOAD_HISTORY from DB for new session
      const dbMessages: Message[] = [
        { id: 'db_user', role: 'user', content: 'What is 2+2?', timestamp: Date.now() },
      ];
      const afterHistory = streamReducer(afterClear, {
        type: 'LOAD_HISTORY',
        messages: dbMessages,
        isActive: true,
      });
      expect(afterHistory.lastSeq).toBe(0);
      expect(afterHistory.streaming).toBe(true);

      // Step 4: stream_active from join_session (new session seq space)
      const afterActive = streamReducer(afterHistory, { type: 'STREAM_ACTIVE', seq: 3 });
      expect(afterActive.streaming).toBe(true);
      expect(afterActive.lastSeq).toBe(3);

      // Step 5: stream_content_sync (no seq from server)
      const afterSync = streamReducer(afterActive, {
        type: 'STREAM_CONTENT_SYNC',
        content: 'The answer is ',
        seq: 0,
      });
      expect(afterSync.messages.length).toBeGreaterThanOrEqual(2);
      const lastMsg = afterSync.messages[afterSync.messages.length - 1];
      expect(lastMsg.content).toBe('The answer is ');
      expect(lastMsg.streaming).toBe(true);

      // Step 6: text_delta arrives (seq=4, continuing from stream_active seq=3)
      const afterDelta = streamReducer(afterSync, {
        type: 'TEXT_DELTA',
        text: '4.',
        messageIndex: 0,
        seq: 4,
      });
      const finalMsg = afterDelta.messages[afterDelta.messages.length - 1];
      expect(finalMsg.content).toBe('The answer is 4.');
      expect(afterDelta.lastSeq).toBe(4);
    });
  });
});
