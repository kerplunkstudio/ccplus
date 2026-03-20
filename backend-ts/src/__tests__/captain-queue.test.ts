import { describe, it, expect } from 'vitest';
import { createCaptainQueue, type QueuedMessage } from '../captain-queue.js';

describe('CaptainQueue', () => {
  describe('push then iterate', () => {
    it('returns pushed value', async () => {
      const queue = createCaptainQueue();
      const message: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Test message',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };

      queue.push(message);

      const iterator = queue[Symbol.asyncIterator]();
      const result = await iterator.next();

      expect(result.done).toBe(false);
      expect(result.value).toEqual(message);
    });

    it('buffers multiple pushes correctly', async () => {
      const queue = createCaptainQueue();
      const message1: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'First',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };
      const message2: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Second',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };
      const message3: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Third',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };

      queue.push(message1);
      queue.push(message2);
      queue.push(message3);

      const iterator = queue[Symbol.asyncIterator]();

      const result1 = await iterator.next();
      expect(result1.done).toBe(false);
      expect(result1.value.message.content).toBe('First');

      const result2 = await iterator.next();
      expect(result2.done).toBe(false);
      expect(result2.value.message.content).toBe('Second');

      const result3 = await iterator.next();
      expect(result3.done).toBe(false);
      expect(result3.value.message.content).toBe('Third');
    });
  });

  describe('iterate then push', () => {
    it('resolves pending consumer', async () => {
      const queue = createCaptainQueue();
      const message: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Late message',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };

      const iterator = queue[Symbol.asyncIterator]();
      const nextPromise = iterator.next();

      // Push after starting iteration
      queue.push(message);

      const result = await nextPromise;
      expect(result.done).toBe(false);
      expect(result.value).toEqual(message);
    });
  });

  describe('close behavior', () => {
    it('terminates iterator with done: true', async () => {
      const queue = createCaptainQueue();

      queue.close();

      const iterator = queue[Symbol.asyncIterator]();
      const result = await iterator.next();

      expect(result.done).toBe(true);
    });

    it('resolves pending consumer on close', async () => {
      const queue = createCaptainQueue();

      const iterator = queue[Symbol.asyncIterator]();
      const nextPromise = iterator.next();

      queue.close();

      const result = await nextPromise;
      expect(result.done).toBe(true);
    });

    it('ignores push after close', async () => {
      const queue = createCaptainQueue();
      const message: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Too late',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };

      queue.close();
      queue.push(message);

      const iterator = queue[Symbol.asyncIterator]();
      const result = await iterator.next();

      expect(result.done).toBe(true);
    });
  });

  describe('empty queue blocking', () => {
    it('blocks until push when queue is empty', async () => {
      const queue = createCaptainQueue();
      const message: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Delayed',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
      };

      const iterator = queue[Symbol.asyncIterator]();
      const nextPromise = iterator.next();

      let resolved = false;
      nextPromise.then(() => {
        resolved = true;
      });

      // Wait a bit to verify it hasn't resolved
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(resolved).toBe(false);

      // Now push and verify it resolves
      queue.push(message);
      const result = await nextPromise;
      expect(result.done).toBe(false);
      expect(result.value).toEqual(message);
    });
  });

  describe('concurrent pushes', () => {
    it('handles multiple sources without losing messages', async () => {
      const queue = createCaptainQueue();
      const messages: QueuedMessage[] = [];

      for (let i = 0; i < 10; i++) {
        const message: QueuedMessage = {
          type: 'user',
          message: {
            role: 'user',
            content: `Message ${i}`,
          },
          parent_tool_use_id: null,
          session_id: 'test-session',
        };
        messages.push(message);
        queue.push(message);
      }

      const iterator = queue[Symbol.asyncIterator]();
      const received: QueuedMessage[] = [];

      for (let i = 0; i < 10; i++) {
        const result = await iterator.next();
        expect(result.done).toBe(false);
        received.push(result.value);
      }

      expect(received.length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(received[i].message.content).toBe(`Message ${i}`);
      }
    });
  });

  describe('priority field support', () => {
    it('accepts messages with priority field', async () => {
      const queue = createCaptainQueue();
      const message: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Priority message',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
        priority: 'now',
      };

      queue.push(message);

      const iterator = queue[Symbol.asyncIterator]();
      const result = await iterator.next();

      expect(result.done).toBe(false);
      expect(result.value.priority).toBe('now');
    });
  });

  describe('isSynthetic field support', () => {
    it('accepts messages with isSynthetic field', async () => {
      const queue = createCaptainQueue();
      const message: QueuedMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: 'Synthetic message',
        },
        parent_tool_use_id: null,
        session_id: 'test-session',
        isSynthetic: true,
      };

      queue.push(message);

      const iterator = queue[Symbol.asyncIterator]();
      const result = await iterator.next();

      expect(result.done).toBe(false);
      expect(result.value.isSynthetic).toBe(true);
    });
  });
});
