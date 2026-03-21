/**
 * Telegram bridge for Captain.
 * Forwards text and voice messages to Captain and sends formatted responses back.
 * Voice messages are transcribed locally using whisper-cli.
 */

import { Bot, Context } from 'grammy';
import * as config from './config.js';
import * as captain from './captain.js';
import { formatForTelegram, escapeMarkdownV2 } from './telegram-format.js';
import { log } from './logger.js';
import { downloadTelegramFile, transcribeAudio } from './voice-transcriber.js';

// ---- Types ----

interface ChatState {
  readonly callbackId: string;
  readonly pendingText: string;
  readonly typingInterval: ReturnType<typeof setInterval> | null;
}

// ---- State ----

let bot: Bot | null = null;
const chatStates = new Map<number, ChatState>();

// Typing indicator interval
const TYPING_INTERVAL_MS = 4000;

// ---- Public API ----

export async function startTelegramBridge(): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) {
    log.info('Telegram bridge skipped: no CCPLUS_TELEGRAM_BOT_TOKEN set');
    return;
  }

  if (bot) {
    log.warn('Telegram bridge already running');
    return;
  }

  bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // Log allowlist status
  if (config.TELEGRAM_ALLOWLIST.length === 0) {
    log.warn('Telegram bridge running without allowlist — any user can interact with Captain');
  } else {
    log.info('Telegram bridge allowlist configured', { count: config.TELEGRAM_ALLOWLIST.length });
  }

  // -- Commands --

  bot.command('start', async (ctx) => {
    if (!isAllowed(ctx)) {
      await ctx.reply('Access denied. Contact the cc+ admin for access.');
      return;
    }
    await ctx.reply(
      escapeMarkdownV2('cc+ Captain — Fleet orchestrator.\n\nSend a message to interact. Captain can start sessions, monitor progress, and manage your coding agents.'),
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.command('status', async (ctx) => {
    if (!isAllowed(ctx)) {
      await ctx.reply('Access denied.');
      return;
    }
    if (!captain.isCaptainAlive()) {
      await ctx.reply('Captain is not active.');
      return;
    }
    // Forward as a regular message to Captain
    await handleMessage(ctx, 'What is the current fleet status? List all sessions.');
  });

  bot.command('clear', async (ctx) => {
    if (!isAllowed(ctx)) return;
    await ctx.reply('Chat context cleared on Telegram side. Captain retains its session memory.');
  });

  // -- Message handler --

  bot.on('message:text', async (ctx) => {
    if (!isAllowed(ctx)) {
      await ctx.reply('Access denied. Contact the cc+ admin for access.');
      return;
    }

    const text = ctx.message.text;
    if (!text || text.startsWith('/')) return;

    await handleMessage(ctx, text);
  });

  // -- Voice message handler --

  bot.on('message:voice', async (ctx) => {
    if (!isAllowed(ctx)) {
      await ctx.reply('Access denied. Contact the cc+ admin for access.');
      return;
    }

    const fileId = ctx.message.voice.file_id;
    const chatId = ctx.chat.id;

    try {
      await ctx.replyWithChatAction('typing');

      log.info('Downloading voice message', { chatId, fileId });
      const audioBuffer = await downloadTelegramFile(config.TELEGRAM_BOT_TOKEN!, fileId);

      log.info('Transcribing voice message', { chatId, fileId, size: audioBuffer.length });
      const transcription = await transcribeAudio(audioBuffer);

      if (!transcription.trim()) {
        await ctx.reply('Could not detect speech in voice message. Please try sending text instead.');
        return;
      }

      log.info('Voice message transcribed', { chatId, fileId, length: transcription.length });
      await handleMessage(ctx, `[Voice] ${transcription.trim()}`);
    } catch (error) {
      log.error('Telegram voice message error', { chatId, fileId, error: String(error) });
      await ctx.reply('Could not transcribe voice message. Please try sending text instead.');
    }
  });

  // -- Error handler --

  bot.catch((err) => {
    log.error('Telegram bot error', { error: String(err.error) });
  });

  // Start polling
  bot.start({
    onStart: () => {
      log.info('Telegram bridge started (polling mode)');
    },
  });
}

export async function stopTelegramBridge(): Promise<void> {
  if (!bot) return;

  // Clean up all chat states
  for (const [chatId, state] of chatStates.entries()) {
    if (state.typingInterval) {
      clearInterval(state.typingInterval);
    }
    captain.unregisterResponseCallback(state.callbackId);
    chatStates.delete(chatId);
  }

  bot.stop();
  bot = null;
  log.info('Telegram bridge stopped');
}

export function isTelegramBridgeActive(): boolean {
  return bot !== null;
}

// ---- Internal ----

function isAllowed(ctx: Context): boolean {
  if (config.TELEGRAM_ALLOWLIST.length === 0) return true;

  const userId = String(ctx.from?.id ?? '');
  const username = ctx.from?.username ?? '';

  return config.TELEGRAM_ALLOWLIST.includes(userId) ||
    config.TELEGRAM_ALLOWLIST.includes(username);
}

async function handleMessage(ctx: Context, text: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  if (!captain.isCaptainAlive()) {
    await ctx.reply('Captain is not active. Start cc+ first.');
    return;
  }

  // Send typing indicator
  await ctx.replyWithChatAction('typing');

  // Set up typing interval
  const existingState = chatStates.get(chatId);
  if (existingState?.typingInterval) {
    clearInterval(existingState.typingInterval);
  }

  const typingInterval = setInterval(async () => {
    try {
      await ctx.api.sendChatAction(chatId, 'typing');
    } catch {
      // Ignore typing indicator errors
    }
  }, TYPING_INTERVAL_MS);

  // Initialize chat state
  const callbackId = `telegram:${chatId}`;
  const newState: ChatState = {
    callbackId,
    pendingText: '',
    typingInterval,
  };
  chatStates.set(chatId, newState);

  // Register Captain response callback
  captain.unregisterResponseCallback(callbackId); // Clean up any existing
  captain.registerResponseCallback(callbackId, {
    onText: (responseText: string, _messageIndex: number) => {
      handleResponseText(chatId, responseText).catch((err) => {
        log.error('Telegram onText error', { chatId, error: String(err) });
      });
    },
    onThinking: (_thinking: string) => {
      // Keep typing indicator running, don't forward thinking content
    },
    onComplete: () => {
      handleComplete(chatId).catch((err) => {
        log.error('Telegram onComplete error', { chatId, error: String(err) });
      });
    },
    onError: (message: string) => {
      handleError(chatId, message).catch((err) => {
        log.error('Telegram onError error', { chatId, error: String(err) });
      });
    },
  });

  // Send immediate acknowledgment
  if (bot) {
    await bot.api.sendMessage(chatId, '⏳');
  }

  // Send to Captain
  try {
    captain.sendCaptainMessage(text, 'telegram', String(chatId));
  } catch (error) {
    cleanupChatState(chatId);
    await ctx.reply(`Error: ${String(error)}`);
  }
}

async function handleResponseText(chatId: number, text: string): Promise<void> {
  const state = chatStates.get(chatId);
  if (!state) return;

  // Only accumulate text — sending happens in handleComplete
  chatStates.set(chatId, {
    ...state,
    pendingText: state.pendingText ? state.pendingText + '\n\n' + text : text,
  });
}

async function handleComplete(chatId: number): Promise<void> {
  if (!bot) return;

  const state = chatStates.get(chatId);
  if (!state) return;

  try {
    if (state.pendingText) {
      // Format and send final version with markdown
      const chunks = formatForTelegram(state.pendingText);

      for (const chunk of chunks) {
        try {
          await bot.api.sendMessage(chatId, chunk, { parse_mode: 'MarkdownV2' });
        } catch {
          // Fallback: send without formatting
          await bot.api.sendMessage(chatId, chunk);
        }
        await delay(100);
      }
    }
  } catch (error) {
    log.error('Telegram complete error', { chatId, error: String(error) });
  } finally {
    cleanupChatState(chatId);
  }
}

async function handleError(chatId: number, message: string): Promise<void> {
  if (!bot) return;

  try {
    const errorText = `⚠ ${message}`;
    const state = chatStates.get(chatId);

    await bot.api.sendMessage(chatId, errorText);
  } catch (error) {
    log.error('Telegram error handler failed', { chatId, error: String(error) });
  } finally {
    cleanupChatState(chatId);
  }
}

function cleanupChatState(chatId: number): void {
  const state = chatStates.get(chatId);
  if (!state) return;

  if (state.typingInterval) {
    clearInterval(state.typingInterval);
  }
  // Don't unregister callback — keep it for future messages in this chat
  chatStates.set(chatId, {
    ...state,
    pendingText: '',
    typingInterval: null,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
