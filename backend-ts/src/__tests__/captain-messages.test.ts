/**
 * Tests for captain-messages.ts
 * Ensures getCaptainMessages returns the NEWEST N messages, not oldest.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db/connection.js";
import {
  saveCaptainMessage,
  getCaptainMessages,
  getLatestCaptainConversationId,
} from "../db/captain-messages.js";

describe("Captain Messages", () => {
  const testConvId = `test-conv-${Date.now()}`;

  beforeAll(() => {
    // Insert 150 messages with incrementing timestamps
    for (let i = 1; i <= 150; i++) {
      saveCaptainMessage({
        conversationId: testConvId,
        role: "user",
        content: `Message ${i}`,
        source: "test",
        sourceId: "test-id",
        messageIndex: i,
      });
    }
  });

  afterAll(() => {
    // Clean up test data
    const db = getDb();
    db.prepare("DELETE FROM captain_messages WHERE conversation_id = ?").run(
      testConvId
    );
  });

  it("should return the NEWEST 100 messages when limit=100 and there are 150 messages", () => {
    const messages = getCaptainMessages(testConvId, 100);

    expect(messages).toHaveLength(100);
    // Should return messages 51-150 (the newest 100)
    expect(messages[0].content).toBe("Message 51");
    expect(messages[99].content).toBe("Message 150");
  });

  it("should return messages in chronological order (oldest first within the result set)", () => {
    const messages = getCaptainMessages(testConvId, 100);

    // Verify ascending order
    for (let i = 1; i < messages.length; i++) {
      const prevIndex = parseInt(messages[i - 1].content.split(" ")[1]);
      const currIndex = parseInt(messages[i].content.split(" ")[1]);
      expect(currIndex).toBe(prevIndex + 1);
    }
  });

  it("should return all messages when limit is greater than total count", () => {
    const messages = getCaptainMessages(testConvId, 200);

    expect(messages).toHaveLength(150);
    expect(messages[0].content).toBe("Message 1");
    expect(messages[149].content).toBe("Message 150");
  });

  it("should return the newest 50 messages when limit=50", () => {
    const messages = getCaptainMessages(testConvId, 50);

    expect(messages).toHaveLength(50);
    // Should return messages 101-150 (the newest 50)
    expect(messages[0].content).toBe("Message 101");
    expect(messages[49].content).toBe("Message 150");
  });

  it("should return empty array when conversation does not exist", () => {
    const messages = getCaptainMessages("non-existent-conv", 100);
    expect(messages).toEqual([]);
  });

  it("should use latest conversation ID when no conversationId provided", () => {
    // Save a message in a new conversation
    const newConvId = `latest-test-conv-${Date.now()}`;
    saveCaptainMessage({
      conversationId: newConvId,
      role: "user",
      content: "Latest message",
      source: "test",
      sourceId: "test-id",
    });

    const latestConvId = getLatestCaptainConversationId();
    expect(latestConvId).toBe(newConvId);

    const messages = getCaptainMessages(undefined, 100);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[messages.length - 1].conversation_id).toBe(newConvId);

    // Clean up
    const db = getDb();
    db.prepare("DELETE FROM captain_messages WHERE conversation_id = ?").run(
      newConvId
    );
  });
});
