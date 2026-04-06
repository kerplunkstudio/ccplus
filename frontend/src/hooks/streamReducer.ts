import { Message, ToolEvent, SessionStatus } from '../types';

// State that the reducer manages
export interface StreamState {
  messages: Message[];
  status: SessionStatus;
  streaming: boolean; // Derived: status === 'streaming' || status === 'submitted' (kept for backward compat)
  backgroundProcessing: boolean;
  thinking: string;
  isThinking: boolean;
  lastSeq: number;
  activeStreamId: string | null;
  streamingContent: string;
  messageIndex: number;
  intermediateCompletion: boolean;
}

export const initialStreamState: StreamState = {
  messages: [],
  status: 'idle',
  streaming: false,
  backgroundProcessing: false,
  thinking: '',
  isThinking: false,
  lastSeq: 0,
  activeStreamId: null,
  streamingContent: '',
  messageIndex: 0,
  intermediateCompletion: false,
};

// Response complete payload shape (matches server emit)
export interface ResponseCompletePayload {
  message_id?: string;
  content?: string;
  cost?: number;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  sdk_session_id?: string | null;
  session_id?: string;
  context_window_size?: number;
  seq?: number;
}

export type StreamAction =
  | { type: 'TEXT_DELTA'; text: string; messageIndex: number; seq: number }
  | { type: 'RESPONSE_COMPLETE'; data: ResponseCompletePayload; toolLog: ToolEvent[]; seq: number }
  | { type: 'STREAM_ACTIVE'; seq: number }
  | { type: 'ERROR'; message: string; seq: number }
  | { type: 'COMPACT_BOUNDARY'; seq: number }
  | { type: 'THINKING_DELTA'; text: string }
  | { type: 'THINKING_STATUS'; isThinking: boolean }
  | { type: 'FINALIZE_STREAM' }
  | { type: 'SEND_MESSAGE'; message: Message }
  | { type: 'CANCEL_QUERY' }
  | { type: 'LOAD_HISTORY'; messages: Message[]; isActive: boolean; streamingContent?: string }
  | { type: 'CLEAR' }
  | { type: 'SET_STREAMING'; value: boolean }
  | { type: 'SET_BACKGROUND_PROCESSING'; value: boolean }
  | { type: 'STREAM_CONTENT_SYNC'; content: string; seq: number }
  | { type: 'SAFETY_TIMEOUT' }
  | { type: 'DISCONNECT_RESET' };

function generateMessageId(): string {
  return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function finalizeMessage(
  messages: Message[],
  activeStreamId: string,
  streamingContent: string,
  toolLog?: ToolEvent[]
): Message[] {
  const idx = messages.findIndex((msg) => msg.id === activeStreamId);
  if (idx === -1) return messages;
  const updated = [...messages];
  updated[idx] = {
    ...updated[idx],
    content: streamingContent || updated[idx].content,
    streaming: false,
    toolLog: toolLog || updated[idx].toolLog,
  };
  return updated;
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'TEXT_DELTA': {
      // Deduplicate replayed events
      if (action.seq <= state.lastSeq) {
        return state;
      }

      let newMessages = state.messages;
      let newActiveStreamId = state.activeStreamId;
      let newStreamingContent = state.streamingContent;
      let newIntermediateCompletion = state.intermediateCompletion;

      // Message index changed - finalize current and start new
      if (action.messageIndex !== state.messageIndex && state.activeStreamId) {
        newMessages = finalizeMessage(newMessages, state.activeStreamId, state.streamingContent);
        newActiveStreamId = null;
        newStreamingContent = '';
      }

      // No active stream - create or reuse last message
      if (!newActiveStreamId) {
        const lastMessage = newMessages[newMessages.length - 1];
        const canReuseLastMessage =
          lastMessage &&
          lastMessage.role === 'assistant' &&
          lastMessage.streaming &&
          !newIntermediateCompletion;

        if (canReuseLastMessage) {
          // Reuse existing streaming message
          newActiveStreamId = lastMessage.id;
          newStreamingContent = action.text;
          const reuseIdx = newMessages.length - 1;
          newMessages = [...newMessages];
          newMessages[reuseIdx] = { ...newMessages[reuseIdx], content: newStreamingContent };
        } else {
          // Create new message
          const newMessage: Message = {
            id: generateMessageId(),
            role: 'assistant',
            content: action.text,
            timestamp: Date.now(),
            streaming: true,
          };
          newActiveStreamId = newMessage.id;
          newStreamingContent = action.text;
          newMessages = [...newMessages, newMessage];
        }
        newIntermediateCompletion = false;
      } else {
        // Append to existing stream
        newStreamingContent = state.streamingContent + action.text;
        const appendIdx = newMessages.findIndex((msg) => msg.id === newActiveStreamId);
        if (appendIdx !== -1) {
          newMessages = [...newMessages];
          newMessages[appendIdx] = { ...newMessages[appendIdx], content: newStreamingContent };
        }
      }

      return {
        ...state,
        messages: newMessages,
        status: 'streaming',
        streaming: true,
        backgroundProcessing: false,
        isThinking: false, // Fix A5: text arriving means thinking is over
        lastSeq: action.seq,
        activeStreamId: newActiveStreamId,
        streamingContent: newStreamingContent,
        messageIndex: action.messageIndex,
        intermediateCompletion: newIntermediateCompletion,
      };
    }

    case 'RESPONSE_COMPLETE': {
      // Deduplicate replayed events
      if (action.seq <= state.lastSeq) {
        return state;
      }

      const isFinalCompletion =
        action.data.sdk_session_id !== null && action.data.sdk_session_id !== undefined;

      let newMessages = state.messages;

      // Finalize active message
      if (state.activeStreamId) {
        const content = state.streamingContent || action.data.content || '';
        newMessages = finalizeMessage(newMessages, state.activeStreamId, content, action.toolLog);
      }

      if (isFinalCompletion) {
        // Final completion - clear everything
        return {
          ...state,
          messages: newMessages,
          status: 'idle',
          streaming: false,
          backgroundProcessing: false,
          thinking: '',
          isThinking: false,
          lastSeq: action.seq,
          activeStreamId: null,
          streamingContent: '',
          messageIndex: 0,
          intermediateCompletion: false,
        };
      } else {
        // Intermediate completion - Fix A4: also clear isThinking
        return {
          ...state,
          messages: newMessages,
          status: 'idle',
          streaming: false,
          isThinking: false,
          lastSeq: action.seq,
          activeStreamId: null,
          streamingContent: '',
          intermediateCompletion: true,
        };
      }
    }

    case 'STREAM_ACTIVE': {
      // Deduplicate replayed events
      if (action.seq <= state.lastSeq) {
        return state;
      }

      return {
        ...state,
        status: 'streaming',
        streaming: true,
        lastSeq: action.seq,
      };
    }

    case 'ERROR': {
      // Deduplicate replayed events
      if (action.seq <= state.lastSeq) {
        return state;
      }

      const errorMessage: Message = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${action.message}`,
        timestamp: Date.now(),
        streaming: false,
      };

      return {
        ...state,
        messages: [...state.messages, errorMessage],
        status: 'error',
        streaming: false,
        backgroundProcessing: false,
        isThinking: false,
        lastSeq: action.seq,
        activeStreamId: null,
        streamingContent: '',
        intermediateCompletion: false,
      };
    }

    case 'COMPACT_BOUNDARY': {
      // Deduplicate replayed events
      if (action.seq <= state.lastSeq) {
        return state;
      }

      const boundaryMessage: Message = {
        id: `compact_${Date.now()}`,
        role: 'assistant',
        content: '↻ Context compacted',
        timestamp: Date.now(),
        streaming: false,
        isCompactBoundary: true,
      };

      return {
        ...state,
        messages: [...state.messages, boundaryMessage],
        lastSeq: action.seq,
      };
    }

    case 'THINKING_DELTA': {
      return {
        ...state,
        thinking: state.thinking + action.text,
      };
    }

    case 'THINKING_STATUS': {
      return {
        ...state,
        isThinking: action.isThinking,
      };
    }

    case 'FINALIZE_STREAM': {
      if (!state.activeStreamId || !state.streamingContent) {
        return state;
      }

      return {
        ...state,
        messages: finalizeMessage(state.messages, state.activeStreamId, state.streamingContent),
        activeStreamId: null,
        streamingContent: '',
      };
    }

    case 'SEND_MESSAGE': {
      if (state.streaming) {
        // Mid-stream injection: just append user message, keep stream state
        return {
          ...state,
          messages: [...state.messages, action.message],
        };
      }
      return {
        ...state,
        messages: [...state.messages, action.message],
        status: 'submitted',
        streaming: true, // submitted counts as streaming for backward compat
        isThinking: false,
        activeStreamId: null,
        streamingContent: '',
        messageIndex: 0,
        intermediateCompletion: false,
        thinking: '',
      };
    }

    case 'CANCEL_QUERY': {
      let newMessages = state.messages;

      // Finalize active stream if exists
      if (state.activeStreamId) {
        newMessages = finalizeMessage(newMessages, state.activeStreamId, state.streamingContent);
      }

      return {
        ...state,
        messages: newMessages,
        status: 'idle',
        streaming: false,
        backgroundProcessing: false,
        isThinking: false,
        activeStreamId: null,
        streamingContent: '',
        intermediateCompletion: false,
      };
    }

    case 'LOAD_HISTORY': {
      if (action.isActive) {
        const lastMessage = action.messages[action.messages.length - 1];

        if (action.streamingContent) {
          // We have streaming content to display
          if (lastMessage && lastMessage.role === 'assistant') {
            // Last message IS an assistant message — update it with streaming content
            const lastIdx = action.messages.length - 1;
            const messagesWithStreaming = [...action.messages];
            messagesWithStreaming[lastIdx] = {
              ...messagesWithStreaming[lastIdx],
              content: action.streamingContent,
              streaming: true,
            };
            return {
              ...state,
              messages: messagesWithStreaming,
              status: 'streaming',
              streaming: true,
              activeStreamId: lastMessage.id,
              streamingContent: action.streamingContent || '',
              lastSeq: 0,
            };
          } else {
            // Last message is NOT an assistant message (e.g., it's a user message)
            // Create a new streaming message at the end
            const newMessage: Message = {
              id: generateMessageId(),
              role: 'assistant',
              content: action.streamingContent,
              timestamp: Date.now(),
              streaming: true,
            };
            return {
              ...state,
              messages: [...action.messages, newMessage],
              status: 'streaming',
              streaming: true,
              activeStreamId: newMessage.id,
              streamingContent: action.streamingContent || '',
              lastSeq: 0,
            };
          }
        } else {
          // No streaming content yet, just mark as active
          if (lastMessage && lastMessage.role === 'assistant') {
            // Mark the last assistant message as streaming
            const lastIdx = action.messages.length - 1;
            const messagesWithStreaming = [...action.messages];
            messagesWithStreaming[lastIdx] = { ...messagesWithStreaming[lastIdx], streaming: true };
            return {
              ...state,
              messages: messagesWithStreaming,
              status: 'streaming',
              streaming: true,
              activeStreamId: lastMessage.id,
              streamingContent: '',
              lastSeq: 0,
            };
          } else {
            // No assistant message at the end, just set streaming state
            return {
              ...state,
              messages: action.messages,
              status: 'streaming',
              streaming: true,
              streamingContent: '',
              lastSeq: 0,
            };
          }
        }
      }

      return {
        ...state,
        messages: action.messages,
        lastSeq: 0,
      };
    }

    case 'CLEAR': {
      return initialStreamState;
    }

    case 'SET_STREAMING': {
      return {
        ...state,
        status: action.value ? 'streaming' : 'idle',
        streaming: action.value,
      };
    }

    case 'SET_BACKGROUND_PROCESSING': {
      return {
        ...state,
        backgroundProcessing: action.value,
      };
    }

    case 'STREAM_CONTENT_SYNC': {
      // Empty content is a no-op
      if (!action.content) {
        return state;
      }

      let newMessages = state.messages;
      let newActiveStreamId = state.activeStreamId;
      let newStreamingContent = action.content;

      // If there's already an active stream, update it
      if (state.activeStreamId) {
        const syncIdx = newMessages.findIndex((msg) => msg.id === state.activeStreamId);
        if (syncIdx !== -1) {
          newMessages = [...newMessages];
          newMessages[syncIdx] = { ...newMessages[syncIdx], content: action.content };
        }
      } else {
        // Check if last message is a streaming assistant message
        const lastMessage = newMessages[newMessages.length - 1];
        const canReuseLastMessage =
          lastMessage &&
          lastMessage.role === 'assistant' &&
          lastMessage.streaming;

        if (canReuseLastMessage) {
          // Reuse existing streaming message
          newActiveStreamId = lastMessage.id;
          const reuseIdx = newMessages.length - 1;
          newMessages = [...newMessages];
          newMessages[reuseIdx] = { ...newMessages[reuseIdx], content: action.content };
        } else {
          // Create new assistant message
          const newMessage: Message = {
            id: generateMessageId(),
            role: 'assistant',
            content: action.content,
            timestamp: Date.now(),
            streaming: true,
          };
          newActiveStreamId = newMessage.id;
          newMessages = [...newMessages, newMessage];
        }
      }

      return {
        ...state,
        messages: newMessages,
        status: 'streaming',
        streaming: true,
        activeStreamId: newActiveStreamId,
        streamingContent: newStreamingContent,
        lastSeq: action.seq > state.lastSeq ? action.seq : state.lastSeq,
      };
    }

    case 'SAFETY_TIMEOUT': {
      // Safety timeout fired — force back to idle to unblock the UI
      let newMessages = state.messages;
      if (state.activeStreamId) {
        newMessages = finalizeMessage(newMessages, state.activeStreamId, state.streamingContent);
      }
      return {
        ...state,
        messages: newMessages,
        status: 'idle',
        streaming: false,
        backgroundProcessing: false,
        isThinking: false,
        activeStreamId: null,
        streamingContent: '',
        intermediateCompletion: false,
      };
    }

    case 'DISCONNECT_RESET': {
      // Socket disconnected — reset transient streaming state
      let newMessages = state.messages;
      if (state.activeStreamId) {
        newMessages = finalizeMessage(newMessages, state.activeStreamId, state.streamingContent);
      }
      return {
        ...state,
        messages: newMessages,
        status: 'idle',
        streaming: false,
        isThinking: false,
        activeStreamId: null,
        streamingContent: '',
        intermediateCompletion: false,
      };
    }

    default:
      return state;
  }
}
