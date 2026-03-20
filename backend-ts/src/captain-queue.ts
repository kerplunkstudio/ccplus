/**
 * captain-queue.ts
 *
 * Async push queue for bridging push-based message sources to AsyncIterable
 * for the Claude Agent SDK's query() method.
 */

/**
 * Message type compatible with SDK's SDKUserMessage.
 */
export interface QueuedMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
  };
  parent_tool_use_id: string | null;
  session_id: string;
  isSynthetic?: boolean;
  priority?: 'now' | 'next' | 'later';
}

/**
 * Async queue interface supporting push-based message insertion
 * and AsyncIterator consumption.
 */
export interface CaptainQueue {
  /**
   * Push a message into the queue.
   * If a consumer is waiting, resolves immediately.
   * Otherwise, appends to internal buffer.
   */
  push(message: QueuedMessage): void;

  /**
   * Close the queue, signaling no more messages will be pushed.
   * Pending consumers receive { done: true }.
   */
  close(): void;

  /**
   * AsyncIterator interface for SDK consumption.
   */
  [Symbol.asyncIterator](): AsyncIterator<QueuedMessage>;
}

/**
 * Create a new CaptainQueue instance.
 *
 * The queue bridges push-based message sources (web UI, Telegram, Discord)
 * to the SDK's AsyncIterable<SDKUserMessage> prompt parameter.
 *
 * Safe for concurrent pushes from multiple sources.
 */
export function createCaptainQueue(): CaptainQueue {
  let buffer: QueuedMessage[] = [];
  let pendingResolve: ((value: IteratorResult<QueuedMessage>) => void) | null = null;
  let closed = false;

  return {
    push(message: QueuedMessage): void {
      if (closed) {
        return;
      }

      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve({ value: message, done: false });
      } else {
        buffer = [...buffer, message];
      }
    },

    close(): void {
      closed = true;
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve({ value: undefined as unknown as QueuedMessage, done: true });
      }
    },

    [Symbol.asyncIterator](): AsyncIterator<QueuedMessage> {
      return {
        next(): Promise<IteratorResult<QueuedMessage>> {
          if (buffer.length > 0) {
            const [message, ...rest] = buffer;
            buffer = rest;
            return Promise.resolve({ value: message, done: false });
          }

          if (closed) {
            return Promise.resolve({ value: undefined as unknown as QueuedMessage, done: true });
          }

          return new Promise<IteratorResult<QueuedMessage>>((resolve) => {
            pendingResolve = resolve;
          });
        }
      };
    }
  };
}
