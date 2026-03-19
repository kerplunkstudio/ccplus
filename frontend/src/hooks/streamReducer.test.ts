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
    it('resets state but preserves lastSeq', () => {
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
      expect(newState.lastSeq).toBe(42); // Preserved
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
});
