/**
 * Telegram bridge for Captain.
 * Forwards text and voice messages to Captain and sends formatted responses back.
 * Voice messages are transcribed locally using whisper-cli.
 */

import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import * as config from './config.js';
import * as captain from './captain.js';
import { formatForTelegram, escapeMarkdownV2 } from './telegram-format.js';
import { log } from './logger.js';
import { downloadTelegramFile, transcribeAudio } from './voice-transcriber.js';
import { saveTelegramState as persistTelegramState, loadTelegramState, removeTelegramState } from './state-persistence.js';

// ---- Types ----

interface ChatState {
  readonly callbackId: string;
  readonly pendingText: string;
  readonly typingInterval: ReturnType<typeof setInterval> | null;
  readonly ackMessageId: number | null;
  readonly pendingOptions: readonly string[];
}

// ---- State ----

let bot: Bot | null = null;
const chatStates = new Map<number, ChatState>();

// Typing indicator interval
const TYPING_INTERVAL_MS = 4000;

// ---- Button text → Captain command mapping ----

const REPLY_KEYBOARD_COMMANDS: Record<string, string> = {
  '📋 Fleet Status': 'What is the current fleet status? List all sessions.',
  '🚀 New Session': 'Start a new session',
  '📊 Sessions List': 'List all active sessions with their status.',
};

// ---- Keyboard builders ----

function buildIdleKeyboard(): Keyboard {
  return new Keyboard()
    .text('📋 Fleet Status').text('🚀 New Session').row()
    .text('📊 Sessions List')
    .resized()
    .persistent();
}

function buildRunningInlineKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('❌ Cancel', 'cancel')
    .text('📊 Status', 'status');
}

function buildCompletedInlineKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔀 Cherry-pick', 'cherry-pick')
    .text('🆕 New Session', 'new-session');
}

function buildApprovalInlineKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Approve', 'approve')
    .text('❌ Reject', 'reject');
}

function buildNumberedOptionsKeyboard(options: string[]): InlineKeyboard {
  return options.slice(0, 5).reduce(
    (kb, _, i) => kb.text(`${i + 1}`, `option:${i + 1}`).row(),
    new InlineKeyboard()
  );
}

// ---- Response analysis ----

// Exported for testing
export function detectApprovalPattern(text: string): boolean {
  const lines = text.trim().split('\n').filter((l) => l.trim());
  const lastLine = lines[lines.length - 1] ?? '';
  const lower = lastLine.toLowerCase();
  return (
    lower.startsWith('want me to') ||
    lower.startsWith('should i') ||
    lower.startsWith('would you like') ||
    lower.startsWith('shall i') ||
    (lastLine.endsWith('?') &&
      (lower.includes('want') || lower.includes('should') || lower.includes('proceed') || lower.includes('approve')))
  );
}

// Exported for testing
export function extractNumberedOptions(text: string): string[] {
  const lines = text.split('\n');
  const options: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)[.)]\s+(.+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num === options.length + 1 && num <= 5) {
        options.push(match[2].trim());
      }
    }
  }
  return options.length >= 2 ? options : [];
}

// ---- Callback data resolver ----

// Exported for testing
export function resolveCallbackCommand(data: string, pendingOptions: readonly string[]): string | null {
  if (data === 'cancel') return 'Cancel the current running session.';
  if (data === 'status') return 'What is the current fleet status? List all sessions.';
  if (data === 'cherry-pick') return 'Cherry-pick the changes from the completed session.';
  if (data === 'new-session') return 'Start a new session.';
  if (data === 'approve') return 'Yes, please proceed.';
  if (data === 'reject') return 'No, please stop.';
  if (data.startsWith('option:')) {
    const idx = parseInt(data.slice(7), 10) - 1;
    const option = pendingOptions[idx];
    return option ?? null;
  }
  return null;
}

// ---- Public API ----

async function cleanupOrphanedAckMessages(botInstance: Bot): Promise<void> {
  const state = loadTelegramState(config.TELEGRAM_STATE_PATH)
  if (!state || state.ackMessages.length === 0) return

  log.info('Cleaning up orphaned Telegram ack messages', { count: state.ackMessages.length })
  for (const { chatId, messageId } of state.ackMessages) {
    try {
      await botInstance.api.deleteMessage(chatId, messageId)
      log.debug('Deleted orphaned ack message', { chatId, messageId })
    } catch {
      log.warn('Could not delete orphaned ack message (may be expired or already deleted)', { chatId, messageId })
    }
  }
  removeTelegramState(config.TELEGRAM_STATE_PATH)
}

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

  // Clean up orphaned ack messages from previous run
  await cleanupOrphanedAckMessages(bot);

  // Log allowlist status
  if (config.TELEGRAM_ALLOWLIST.length === 0) {
    log.warn('Telegram bridge running without allowlist — any user can interact with Captain');
  } else {
    log.info('Telegram bridge allowlist configured', { count: config.TELEGRAM_ALLOWLIST.length });
  }

  // Set up handlers
  setupBotHandlers(bot);

  // Start polling with error recovery and auto-recovery on permanent failure
  startPollingWithRetry().catch((err) => {
    log.error('Telegram polling failed, scheduling recovery in 60s', { error: String(err) });
    bot = null;
    setTimeout(() => {
      log.info('Attempting Telegram bridge auto-recovery');
      startTelegramBridge().catch((e) => log.error('Telegram auto-recovery failed', { error: String(e) }));
    }, 60_000);
  });
}

export async function stopTelegramBridge(): Promise<void> {
  if (!bot) return;

  // Collect pending ack messages before cleanup
  const ackMessages: Array<{ chatId: number; messageId: number }> = []
  for (const [chatId, chatState] of chatStates.entries()) {
    if (chatState.ackMessageId !== null) {
      ackMessages.push({ chatId: Number(chatId), messageId: chatState.ackMessageId })
    }
  }
  if (ackMessages.length > 0) {
    persistTelegramState(ackMessages, config.TELEGRAM_STATE_PATH)
    log.info('Telegram ack state saved', { count: ackMessages.length })
  }

  // Clean up all chat states
  for (const [chatId, state] of chatStates.entries()) {
    if (state.typingInterval) {
      clearInterval(state.typingInterval);
    }
    captain.unregisterResponseCallback(state.callbackId);
    chatStates.delete(chatId);
  }

  try {
    await bot.stop();
  } catch (error) {
    log.warn('Error stopping Telegram bot', { error: String(error) });
  }
  bot = null;
  log.info('Telegram bridge stopped');
}

export function isTelegramBridgeActive(): boolean {
  return bot !== null;
}

export function isTelegramAlive(): boolean {
  return bot !== null;
}

// ---- Internal ----

function setupBotHandlers(botInstance: Bot): void {
  // -- Commands --

  botInstance.command('start', async (ctx) => {
    if (!isAllowed(ctx)) {
      await ctx.reply('Access denied. Contact the cc+ admin for access.');
      return;
    }
    await ctx.reply(
      escapeMarkdownV2('cc+ Captain — Fleet orchestrator.\n\nSend a message to interact. Captain can start sessions, monitor progress, and manage your coding agents.'),
      { parse_mode: 'MarkdownV2', reply_markup: buildIdleKeyboard() }
    );
  });

  botInstance.command('status', async (ctx) => {
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

  botInstance.command('clear', async (ctx) => {
    if (!isAllowed(ctx)) return;
    await ctx.reply('Chat context cleared on Telegram side. Captain retains its session memory.');
  });

  // -- Message handler --

  botInstance.on('message:text', async (ctx) => {
    if (!isAllowed(ctx)) {
      await ctx.reply('Access denied. Contact the cc+ admin for access.');
      return;
    }

    const rawText = ctx.message.text;
    if (!rawText || rawText.startsWith('/')) return;
    const text = REPLY_KEYBOARD_COMMANDS[rawText] ?? rawText;
    await handleMessage(ctx, text);
  });

  // -- Voice message handler --

  botInstance.on('message:voice', async (ctx) => {
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
      const errorMsg = String(error);
      log.error('Telegram voice message error', { chatId, fileId, error: errorMsg });

      // Send user-friendly error message
      if (errorMsg.includes('whisper-cli not installed') || errorMsg.includes('ffmpeg not installed')) {
        await ctx.reply(errorMsg);
      } else {
        await ctx.reply('Could not transcribe voice message. Please try sending text instead.');
      }
    }
  });

  // -- Callback query handler --

  botInstance.on('callback_query:data', async (ctx) => {
    if (!isAllowed(ctx)) {
      await ctx.answerCallbackQuery('Access denied.');
      return;
    }

    const data = ctx.callbackQuery.data;
    const chatId = ctx.callbackQuery.message?.chat?.id;
    if (!chatId) {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery();

    const state = chatStates.get(chatId);
    const command = resolveCallbackCommand(data, state?.pendingOptions ?? []);
    if (command) {
      await handleMessageById(chatId, ctx, command);
    }
  });

  // -- Error handler --

  botInstance.catch((err) => {
    log.error('Telegram bot error', { error: String(err.error) });
  });
}

async function startPollingWithRetry(): Promise<void> {
  const MAX_RETRIES = 8;
  const BASE_DELAY_MS = 1000;
  const MAX_DELAY_MS = 60000;

  // Invalidate any stale polling session from a previous unclean shutdown
  await bot!.api.deleteWebhook({ drop_pending_updates: false });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await bot!.start({
        onStart: () => {
          log.info('Telegram bridge started (polling mode)');
        },
      });
      return; // bot.start() resolved normally (bot was stopped gracefully)
    } catch (error) {
      const errorStr = String(error);
      const is409 = errorStr.includes('409') || errorStr.includes('Conflict');

      if (attempt === MAX_RETRIES) {
        throw error;
      }

      const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      const delayMs = is409 ? Math.max(5000, baseDelay) : baseDelay;
      log.warn('Telegram polling error, retrying', {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs,
        is409,
        error: errorStr,
      });

      if (is409) {
        // Another instance is polling — stop current bot and recreate
        try {
          bot!.stop();
        } catch {
          // Ignore stop errors
        }
        await delay(delayMs);
        bot = new Bot(config.TELEGRAM_BOT_TOKEN!);
        setupBotHandlers(bot);
        // On retry attempts, aggressively reclaim by dropping pending updates
        const dropPending = attempt > 0;
        await bot.api.deleteWebhook({ drop_pending_updates: dropPending });
      } else {
        await delay(delayMs);
      }
    }
  }
}

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
  await handleMessageById(chatId, ctx, text);
}

async function handleMessageById(chatId: number, ctx: Context, text: string): Promise<void> {
  if (!captain.isCaptainAlive()) {
    await ctx.api.sendMessage(chatId, 'Captain is not active. Start cc+ first.');
    return;
  }

  // Send typing indicator
  await ctx.api.sendChatAction(chatId, 'typing');

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
    ackMessageId: null,
    pendingOptions: [],
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

  // Send immediate acknowledgment with running keyboard
  if (bot) {
    const ackMsg = await bot.api.sendMessage(chatId, '⏳', {
      reply_markup: buildRunningInlineKeyboard(),
    });
    const currentState = chatStates.get(chatId);
    if (currentState) {
      chatStates.set(chatId, { ...currentState, ackMessageId: ackMsg.message_id });
    }
  }

  // Send to Captain
  try {
    captain.sendCaptainMessage(text, 'telegram', String(chatId));
  } catch (error) {
    cleanupChatState(chatId);
    await ctx.api.sendMessage(chatId, `Error: ${String(error)}`);
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
    // Delete the ack message
    if (state.ackMessageId) {
      try {
        await bot.api.deleteMessage(chatId, state.ackMessageId);
      } catch {
        // Ignore — message may already be deleted
      }
    }

    if (state.pendingText) {
      // Analyze response to determine appropriate keyboard
      const numberedOptions = extractNumberedOptions(state.pendingText);
      const isApproval = numberedOptions.length === 0 && detectApprovalPattern(state.pendingText);

      let lastChunkKeyboard: InlineKeyboard;
      let resolvedOptions: readonly string[] = [];

      if (numberedOptions.length > 0) {
        lastChunkKeyboard = buildNumberedOptionsKeyboard(numberedOptions);
        resolvedOptions = numberedOptions;
      } else if (isApproval) {
        lastChunkKeyboard = buildApprovalInlineKeyboard();
      } else {
        lastChunkKeyboard = buildCompletedInlineKeyboard();
      }

      // Format and send final version with markdown
      const chunks = formatForTelegram(state.pendingText);

      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const replyMarkup = isLast ? lastChunkKeyboard : undefined;
        try {
          await bot.api.sendMessage(chatId, chunks[i], {
            parse_mode: 'MarkdownV2',
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          });
        } catch {
          // Fallback: send without formatting
          await bot.api.sendMessage(chatId, chunks[i], {
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          });
        }
        await delay(100);
      }

      // Store resolved options for callback handler
      const currentState = chatStates.get(chatId);
      if (currentState) {
        chatStates.set(chatId, { ...currentState, pendingOptions: resolvedOptions });
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

  const state = chatStates.get(chatId);

  try {
    // Delete the ack message
    if (state?.ackMessageId) {
      try {
        await bot.api.deleteMessage(chatId, state.ackMessageId);
      } catch {
        // Ignore — message may already be deleted
      }
    }

    const errorText = `⚠ ${message}`;
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
  // Preserve pendingOptions so callback handler can still resolve them
  chatStates.set(chatId, {
    ...state,
    pendingText: '',
    typingInterval: null,
    ackMessageId: null,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
