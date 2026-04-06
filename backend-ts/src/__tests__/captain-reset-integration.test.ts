/**
 * captain-reset-integration.test.ts
 *
 * Integration test for Captain session reset endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createCaptainRouter } from '../captain-router.js';
import { createServer } from 'http';
import type { AddressInfo } from 'net';

describe('Captain Router - POST /api/captain/messages/clear (integration)', () => {
  let baseUrl: string;
  let closeServer: () => void;
  let resetSessionCalled = false;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    const router = createCaptainRouter({
      getCaptainSessionId: () => null,
      isCaptainAlive: () => true,
      getCaptainStatus: () => ({
        active: true,
        sessionId: 'test-session',
        uptimeMs: 1000,
        messageCount: 5,
        lastInputTokens: 100,
        totalInputTokens: 500,
        contextPct: 0.01,
      }),
      sendCaptainMessage: () => {},
      startCaptainSession: async () => ({ sessionId: 'new-session' }),
      resetCaptainSession: async () => {
        resetSessionCalled = true;
        return { sessionId: 'reset-session-123' };
      },
      workspace: '/tmp/test',
      getCaptainMessages: () => [],
      getLatestCaptainConversationId: () => 'test-conv',
    });

    app.use('/api/captain', router);

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    baseUrl = `http://127.0.0.1:${port}`;
    closeServer = () => server.close();
  });

  afterAll(() => {
    closeServer();
  });

  it('should call resetCaptainSession when clearing messages', async () => {
    const response = await fetch(`${baseUrl}/api/captain/messages/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.session_id).toBe('reset-session-123');
    expect(resetSessionCalled).toBe(true);
  });

  it('should return 500 if resetCaptainSession fails', async () => {
    const app = express();
    app.use(express.json());

    const router = createCaptainRouter({
      getCaptainSessionId: () => null,
      isCaptainAlive: () => true,
      getCaptainStatus: () => ({
        active: true,
        sessionId: 'test-session',
        uptimeMs: 1000,
        messageCount: 5,
        lastInputTokens: 100,
        totalInputTokens: 500,
        contextPct: 0.01,
      }),
      sendCaptainMessage: () => {},
      startCaptainSession: async () => ({ sessionId: 'new-session' }),
      resetCaptainSession: async () => {
        throw new Error('Reset failed');
      },
      workspace: '/tmp/test',
      getCaptainMessages: () => [],
      getLatestCaptainConversationId: () => 'test-conv',
    });

    app.use('/api/captain', router);

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const errorBaseUrl = `http://127.0.0.1:${port}`;

    const response = await fetch(`${errorBaseUrl}/api/captain/messages/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toContain('Reset failed');

    server.close();
  });
});
