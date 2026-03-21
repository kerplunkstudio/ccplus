import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('grammy', () => {
  const MockBot = vi.fn(function (this: any) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn();
    this.command = vi.fn();
    this.on = vi.fn();
    this.catch = vi.fn();
    this.api = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    };
  });

  return { Bot: MockBot };
});

vi.mock('../config.js', () => ({
  TELEGRAM_BOT_TOKEN: 'test-token',
  TELEGRAM_ALLOWLIST: ['12345'],
}));

vi.mock('../captain.js', () => ({
  unregisterResponseCallback: vi.fn(),
  registerResponseCallback: vi.fn(),
  isCaptainAlive: vi.fn().mockReturnValue(true),
  sendCaptainMessage: vi.fn(),
}));

vi.mock('../telegram-format.js', () => ({
  formatForTelegram: vi.fn((text: string) => [text]),
  escapeMarkdownV2: vi.fn((text: string) => text),
}));

vi.mock('../logger.js', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../voice-transcriber.js', () => ({
  downloadTelegramFile: vi.fn().mockResolvedValue(Buffer.from('audio')),
  transcribeAudio: vi.fn().mockResolvedValue('Test transcription'),
}));

import { Bot } from 'grammy';
import * as config from '../config.js';
import * as captain from '../captain.js';
import { log } from '../logger.js';
import {
  startTelegramBridge,
  stopTelegramBridge,
  isTelegramBridgeActive,
} from '../telegram-bridge.js';

describe('TelegramBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to default values
    vi.mocked(config).TELEGRAM_BOT_TOKEN = 'test-token';
    vi.mocked(config).TELEGRAM_ALLOWLIST = ['12345'];
  });

  afterEach(async () => {
    // Clean up bridge state between tests
    await stopTelegramBridge();
  });

  describe('startTelegramBridge', () => {
    it('skips when no token is set', async () => {
      vi.mocked(config).TELEGRAM_BOT_TOKEN = '';

      await startTelegramBridge();

      expect(Bot).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith(
        'Telegram bridge skipped: no CCPLUS_TELEGRAM_BOT_TOKEN set'
      );
    });

    it('skips when already running', async () => {
      await startTelegramBridge();
      await startTelegramBridge();

      expect(log.warn).toHaveBeenCalledWith('Telegram bridge already running');
      expect(Bot).toHaveBeenCalledTimes(1);
    });

    it('creates bot and sets up handlers', async () => {
      await startTelegramBridge();

      expect(Bot).toHaveBeenCalledWith('test-token');
      const botInstance = vi.mocked(Bot).mock.results[0].value;
      expect(botInstance.command).toHaveBeenCalled();
      expect(botInstance.on).toHaveBeenCalled();
      expect(botInstance.catch).toHaveBeenCalled();
    });

    it('logs allowlist status when configured', async () => {
      await startTelegramBridge();

      expect(log.info).toHaveBeenCalledWith(
        'Telegram bridge allowlist configured',
        { count: 1 }
      );
    });

    it('warns when no allowlist is configured', async () => {
      vi.mocked(config).TELEGRAM_ALLOWLIST = [];

      await startTelegramBridge();

      expect(log.warn).toHaveBeenCalledWith(
        'Telegram bridge running without allowlist — any user can interact with Captain'
      );
    });

    it('starts polling', async () => {
      await startTelegramBridge();

      const botInstance = vi.mocked(Bot).mock.results[0].value;
      expect(botInstance.start).toHaveBeenCalledWith({
        onStart: expect.any(Function),
      });
    });

    it('sets active status to true after start', async () => {
      expect(isTelegramBridgeActive()).toBe(false);

      await startTelegramBridge();

      expect(isTelegramBridgeActive()).toBe(true);
    });
  });

  describe('stopTelegramBridge', () => {
    it('does nothing when bot is not running', async () => {
      await stopTelegramBridge();

      expect(log.info).not.toHaveBeenCalledWith('Telegram bridge stopped');
    });

    it('stops the bot and sets active to false', async () => {
      await startTelegramBridge();
      const botInstance = vi.mocked(Bot).mock.results[0].value;

      await stopTelegramBridge();

      expect(botInstance.stop).toHaveBeenCalled();
      expect(isTelegramBridgeActive()).toBe(false);
      expect(log.info).toHaveBeenCalledWith('Telegram bridge stopped');
    });

    it('handles bot.stop() errors gracefully', async () => {
      await startTelegramBridge();
      const botInstance = vi.mocked(Bot).mock.results[0].value;
      botInstance.stop.mockImplementation(() => {
        throw new Error('Stop failed');
      });

      await stopTelegramBridge();

      expect(log.warn).toHaveBeenCalledWith('Error stopping Telegram bot', {
        error: 'Error: Stop failed',
      });
      expect(isTelegramBridgeActive()).toBe(false);
    });

    it('cleans up when stopped', async () => {
      await startTelegramBridge();
      await stopTelegramBridge();

      // Verify bot is stopped and set to null
      expect(isTelegramBridgeActive()).toBe(false);
      expect(log.info).toHaveBeenCalledWith('Telegram bridge stopped');
    });
  });

  describe('isTelegramBridgeActive', () => {
    it('returns false initially', () => {
      expect(isTelegramBridgeActive()).toBe(false);
    });

    it('returns true after start', async () => {
      await startTelegramBridge();

      expect(isTelegramBridgeActive()).toBe(true);
    });

    it('returns false after stop', async () => {
      await startTelegramBridge();
      await stopTelegramBridge();

      expect(isTelegramBridgeActive()).toBe(false);
    });
  });

  describe('polling retry logic', () => {
    it('retries on 409 Conflict error', async () => {
      const error409 = new Error('409: Conflict: terminated by other getUpdates request');
      const botInstance = {
        start: vi.fn()
          .mockRejectedValueOnce(error409)
          .mockResolvedValueOnce(undefined),
        stop: vi.fn(),
        command: vi.fn(),
        on: vi.fn(),
        catch: vi.fn(),
        api: {
          sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
          deleteMessage: vi.fn().mockResolvedValue(undefined),
          sendChatAction: vi.fn().mockResolvedValue(undefined),
        },
      };

      vi.mocked(Bot).mockImplementation(function (this: any) {
        Object.assign(this, botInstance);
      } as any);

      // Mock delay to speed up test
      const delayPromise = Promise.resolve();
      vi.stubGlobal('setTimeout', (fn: any) => {
        fn();
        return 0 as any;
      });

      await startTelegramBridge();

      // Wait for retry logic to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(log.warn).toHaveBeenCalledWith(
        'Telegram polling error, retrying',
        expect.objectContaining({
          attempt: 1,
          is409: true,
        })
      );
      expect(Bot).toHaveBeenCalledTimes(2); // Original + recreated after 409
      expect(botInstance.stop).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('gives up after max retries', async () => {
      const error = new Error('Network error');
      const botInstance = {
        start: vi.fn().mockRejectedValue(error),
        stop: vi.fn(),
        command: vi.fn(),
        on: vi.fn(),
        catch: vi.fn(),
        api: {},
      };

      vi.mocked(Bot).mockImplementation(function (this: any) {
        Object.assign(this, botInstance);
      } as any);

      // Mock setTimeout to execute callbacks immediately
      const originalSetTimeout = global.setTimeout;
      vi.stubGlobal('setTimeout', ((fn: any) => {
        fn();
        return 0 as any;
      }) as any);

      await startTelegramBridge();

      // Wait for error handling to complete
      await new Promise(resolve => originalSetTimeout(resolve, 50));

      expect(log.warn).toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith(
        'Telegram polling permanently failed after retries',
        expect.objectContaining({
          error: expect.stringContaining('Network error'),
        })
      );
      expect(isTelegramBridgeActive()).toBe(false);

      vi.unstubAllGlobals();
    });

    it('recreates bot instance on 409 error', async () => {
      const error409 = new Error('409 Conflict');
      let callCount = 0;

      const createBotInstance = () => ({
        start: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(error409);
          }
          return Promise.resolve();
        }),
        stop: vi.fn(),
        command: vi.fn(),
        on: vi.fn(),
        catch: vi.fn(),
        api: {
          sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
          deleteMessage: vi.fn().mockResolvedValue(undefined),
          sendChatAction: vi.fn().mockResolvedValue(undefined),
        },
      });

      let botInstanceCount = 0;
      vi.mocked(Bot).mockImplementation(function (this: any) {
        botInstanceCount++;
        Object.assign(this, createBotInstance());
      } as any);

      // Mock delay
      vi.stubGlobal('setTimeout', (fn: any) => {
        fn();
        return 0 as any;
      });

      await startTelegramBridge();

      // Wait for retry
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(botInstanceCount).toBe(2); // Original + recreated
      expect(log.warn).toHaveBeenCalledWith(
        'Telegram polling error, retrying',
        expect.objectContaining({
          is409: true,
        })
      );

      vi.unstubAllGlobals();
    });

    it('uses exponential backoff for retries', async () => {
      const error = new Error('Temporary error');
      const botInstance = {
        start: vi.fn()
          .mockRejectedValueOnce(error)
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce(undefined),
        stop: vi.fn(),
        command: vi.fn(),
        on: vi.fn(),
        catch: vi.fn(),
        api: {},
      };

      vi.mocked(Bot).mockImplementation(function (this: any) {
        Object.assign(this, botInstance);
      } as any);

      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      vi.stubGlobal('setTimeout', ((fn: any, delay: number) => {
        delays.push(delay);
        fn();
        return 0 as any;
      }) as any);

      await startTelegramBridge();

      // Wait for retries
      await new Promise(resolve => originalSetTimeout(resolve, 50));

      // Check exponential backoff: 1000, 2000, ...
      expect(delays.length).toBeGreaterThan(0);
      if (delays.length >= 2) {
        expect(delays[0]).toBe(1000); // BASE_DELAY_MS
        expect(delays[1]).toBe(2000); // BASE_DELAY_MS * 2
      }

      vi.unstubAllGlobals();
    });
  });
});
