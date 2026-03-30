/**
 * Regression tests for the Captain messages API endpoint.
 *
 * Bug: GET /api/captain/messages returned the OLDEST N messages when there
 * were more than N messages in the conversation. This caused the chat UI to
 * show stale messages on reload instead of the most recent conversation.
 *
 * Fix: getCaptainMessages now uses a subquery to select the newest N rows
 * (ORDER BY created_at DESC LIMIT N) and then re-orders them chronologically
 * (ORDER BY created_at ASC). The router passes these messages through directly.
 *
 * Regression test: verifies that the endpoint returns the NEWEST N messages
 * in chronological order. With the old query (ASC LIMIT), these tests fail
 * because messages[0] would be "Message 1" instead of "Message 51".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createCaptainRouter } from "../captain-router.js";
import { getDb } from "../db/connection.js";
import {
  saveCaptainMessage,
  getCaptainMessages,
  getLatestCaptainConversationId,
} from "../db/captain-messages.js";
import { createServer } from "http";
import type { AddressInfo } from "net";

// ---- Test helpers ----

function buildTestDeps(convId: string) {
  return {
    getCaptainSessionId: () => null,
    isCaptainAlive: () => true,
    getCaptainStatus: () => ({
      active: false,
      sessionId: null,
      uptimeMs: 0,
      messageCount: 0,
      lastInputTokens: 0,
      totalInputTokens: 0,
      contextPct: 0,
    }),
    sendCaptainMessage: () => {},
    startCaptainSession: async (_workspace: string) => ({ sessionId: "test-session" }),
    workspace: "/tmp/test",
    getCaptainMessages: (conversationId?: string, limit?: number) =>
      getCaptainMessages(conversationId ?? convId, limit),
    getLatestCaptainConversationId: () => convId,
  };
}

async function startTestServer(convId: string): Promise<{ baseUrl: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use("/api/captain", createCaptainRouter(buildTestDeps(convId)));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}

// ---- Tests ----

describe("Captain Router - GET /api/captain/messages (regression)", () => {
  const convId = `router-regression-conv-${Date.now()}`;
  let baseUrl: string;
  let closeServer: () => void;

  beforeAll(async () => {
    // Insert 150 messages so we can test the NEWEST-100 behavior
    for (let i = 1; i <= 150; i++) {
      saveCaptainMessage({
        conversationId: convId,
        role: i % 2 === 0 ? "assistant" : "user",
        content: `Message ${i}`,
        source: "test",
        sourceId: "test-router-regression",
        messageIndex: i,
      });
    }

    const server = await startTestServer(convId);
    baseUrl = server.baseUrl;
    closeServer = server.close;
  });

  afterAll(() => {
    closeServer();
    const db = getDb();
    db.prepare("DELETE FROM captain_messages WHERE conversation_id = ?").run(convId);
  });

  it("returns success:true with messages array", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=${convId}&limit=100`);
    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.messages)).toBe(true);
  });

  it("returns exactly 100 messages when limit=100 and there are 150 messages", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=${convId}&limit=100`);
    const data = await response.json() as any;

    expect(data.messages).toHaveLength(100);
  });

  /**
   * REGRESSION: With the old query (SELECT ... ORDER BY created_at ASC LIMIT 100),
   * the first message returned was "Message 1" (oldest).
   * With the fix (subquery: DESC LIMIT then re-order ASC), the first message is
   * "Message 51" — the oldest of the NEWEST 100.
   */
  it("returns the NEWEST 100 messages — first message is Message 51, not Message 1", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=${convId}&limit=100`);
    const data = await response.json() as any;

    // Old (broken) behavior: data.messages[0].content === "Message 1"
    // New (fixed) behavior: data.messages[0].content === "Message 51"
    expect(data.messages[0].content).toBe("Message 51");
  });

  it("returns messages in chronological order (oldest-of-newest-N first)", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=${convId}&limit=100`);
    const data = await response.json() as any;

    const contents: string[] = data.messages.map((m: any) => m.content);

    // Messages should be in ascending order: 51, 52, ..., 150
    for (let i = 0; i < contents.length - 1; i++) {
      const curr = parseInt(contents[i].split(" ")[1]);
      const next = parseInt(contents[i + 1].split(" ")[1]);
      expect(next).toBe(curr + 1);
    }
  });

  it("last message is Message 150 (the most recent)", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=${convId}&limit=100`);
    const data = await response.json() as any;

    expect(data.messages[data.messages.length - 1].content).toBe("Message 150");
  });

  it("returns all 150 messages when limit=200 (greater than total)", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=${convId}&limit=200`);
    const data = await response.json() as any;

    expect(data.messages).toHaveLength(150);
    expect(data.messages[0].content).toBe("Message 1");
    expect(data.messages[149].content).toBe("Message 150");
  });

  it("returns empty messages array for unknown conversation_id", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=does-not-exist-xyz&limit=100`);
    const data = await response.json() as any;

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.messages).toEqual([]);
  });

  it("returns correct message shape (id, role, content, source, timestamp, conversation_id)", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=${convId}&limit=1`);
    const data = await response.json() as any;

    expect(data.messages).toHaveLength(1);
    const msg = data.messages[0];

    expect(typeof msg.id).toBe("string");
    expect(["user", "assistant", "error"]).toContain(msg.role);
    expect(typeof msg.content).toBe("string");
    expect(typeof msg.source).toBe("string");
    expect(typeof msg.timestamp).toBe("number");
    expect(typeof msg.conversation_id).toBe("string");
  });

  it("includes conversation_id in the response envelope", async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages?conversation_id=${convId}&limit=10`);
    const data = await response.json() as any;

    expect(data).toHaveProperty("conversation_id");
    expect(data.conversation_id).toBe(convId);
  });
});
