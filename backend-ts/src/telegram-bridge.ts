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
import { InteractiveAction, InteractiveMessage } from './interactive-message.js';

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
const knownChatIds = new Set<number>();

interface PendingInteractiveMsg {
  readonly telegramMsgId: number;
  readonly chatId: number;
  readonly message: InteractiveMessage;
  readonly timeoutTimer: ReturnType<typeof setTimeout> | null;
  readonly selectedActionIds?: Set<string>;
}

const pendingInteractiveMsgs = new Map<string, PendingInteractiveMsg>();

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

function buildNumberedOptionsKeyboard(options: string[]): InlineKeyboard {
  return options.slice(0, 5).reduce(
    (kb, _, i) => kb.text(`${i + 1}`, `option:${i + 1}`).row(),
    new InlineKeyboard()
  );
}

// ---- Response analysis ----

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

// Exported for testing
export function isFleetNotification(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('[fleet]')) return true;
  const hasSession = lower.includes('session');
  const hasStatus = lower.includes('completed') || lower.includes('failed') || lower.includes('stuck') || lower.includes('cancelled');
  return hasSession && hasStatus;
}

function registerFleetNotificationCallback(): void {
  const callbackId = 'telegram:fleet';
  captain.registerResponseCallback(callbackId, {
    onText: (text: string, _messageIndex: number) => {
      if (!bot || !isFleetNotification(text)) return;

      for (const chatId of knownChatIds) {
        // Skip chats that already have a per-message callback (they'll get the broadcast)
        if (captain.hasResponseCallback(`telegram:${chatId}`)) continue;

        const chunks = formatForTelegram(text);
        for (const chunk of chunks) {
          bot.api.sendMessage(chatId, chunk, { parse_mode: 'MarkdownV2' })
            .catch(() => {
              bot?.api.sendMessage(chatId, chunk).catch((err) => {
                log.error('Fleet notification send failed', { chatId, error: String(err) });
              });
            });
        }
      }
    },
    onThinking: () => {},
    onComplete: () => {},
    onError: () => {},
  });
  log.info('Fleet notification callback registered for Telegram');
}

// ---- Callback data resolver ----

// Exported for testing
export function resolveCallbackCommand(data: string, pendingOptions: readonly string[]): string | null {
  if (data.startsWith('option:')) {
    const idx = parseInt(data.slice(7), 10) - 1;
    const option = pendingOptions[idx];
    return option ?? null;
  }
  return null;
}

// ---- Public API ----

export async function deliverInteractiveMessage(chatId: number, message: InteractiveMessage): Promise<void> {
  if (!bot) {
    log.warn('Telegram bridge not active, dropping interactive message', { messageId: message.id });
    return;
  }

  const isMultiSelect = message.type === 'multi-select';

  // Build inline keyboard
  let inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;

  if (isMultiSelect) {
    // Multi-select: each action as a toggle button + a "Done" button
    // Format: {"m":"<uuid>","i":0} for toggle, {"m":"<uuid>","done":true} for confirm
    inlineKeyboard = [
      ...message.actions.map((action, i) => [{
        text: action.label,
        callback_data: JSON.stringify({ m: message.id, i }),
      }]),
      [{
        text: '✅ Done',
        callback_data: JSON.stringify({ m: message.id, done: true }),
      }],
    ];
  } else {
    // Single-select: use action index (i) not action id to keep callback_data under 64 bytes
    // Format: {"m":"<36-char-uuid>","i":0} = ~49 chars, well within 64-byte limit
    inlineKeyboard = message.actions.map((action, i) => [{
      text: action.label,
      callback_data: JSON.stringify({ m: message.id, i }),
    }]);
  }

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    const sent = await bot.api.sendMessage(chatId, message.text, {
      reply_markup: { inline_keyboard: inlineKeyboard },
    });

    // Schedule timeout cleanup if timeoutMs is set
    if (message.timeoutMs && message.timeoutMs > 0) {
      timeoutTimer = setTimeout(async () => {
        await expireInteractiveMessage(message.id);
      }, message.timeoutMs);
    }

    pendingInteractiveMsgs.set(message.id, {
      telegramMsgId: sent.message_id,
      chatId,
      message,
      timeoutTimer,
      selectedActionIds: isMultiSelect ? new Set() : undefined,
    });

    log.info('Interactive message sent to Telegram', { messageId: message.id, chatId, actions: message.actions.length, multiSelect: isMultiSelect });
  } catch (error) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    log.error('Failed to send interactive message to Telegram', { messageId: message.id, chatId, error: String(error) });
    throw error;
  }
}

async function expireInteractiveMessage(messageId: string): Promise<void> {
  if (!bot) return;
  const pending = pendingInteractiveMsgs.get(messageId);
  if (!pending) return;

  pendingInteractiveMsgs.delete(messageId);
  if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);

  try {
    await bot.api.editMessageText(pending.chatId, pending.telegramMsgId, 'Expirado');
  } catch (error) {
    log.warn('Could not expire interactive message on Telegram', { messageId, error: String(error) });
  }
}

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

  // Register fleet notification callback
  registerFleetNotificationCallback();

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

  // Clean up pending interactive messages
  for (const [, pending] of pendingInteractiveMsgs.entries()) {
    if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);
  }
  pendingInteractiveMsgs.clear();

  // Clean up all chat states
  for (const [chatId, state] of chatStates.entries()) {
    if (state.typingInterval) {
      clearInterval(state.typingInterval);
    }
    captain.unregisterResponseCallback(state.callbackId);
    chatStates.delete(chatId);
  }

  // Unregister fleet notification callback and clear known chat IDs
  captain.unregisterResponseCallback('telegram:fleet');
  knownChatIds.clear();

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
    knownChatIds.add(ctx.chat!.id);
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

    // Check if this is an interactive message callback (has JSON with m key)
    let parsed: { m?: string; i?: number; done?: boolean } | null = null;
    try {
      const maybeJson = JSON.parse(data);
      if (typeof maybeJson === 'object' && maybeJson !== null && 'm' in maybeJson) {
        parsed = maybeJson as { m: string; i?: number; done?: boolean };
      }
    } catch {
      // Not JSON — fall through to legacy callback handling
    }

    if (parsed && typeof parsed.m === 'string') {
      // Interactive message callback
      const pending = pendingInteractiveMsgs.get(parsed.m);
      if (!pending) {
        await ctx.answerCallbackQuery({ text: 'This message has expired' });
        return;
      }

      const isMultiSelect = pending.message.type === 'multi-select';

      // Handle multi-select "Done" button
      if (parsed.done === true) {
        if (!isMultiSelect) {
          await ctx.answerCallbackQuery();
          log.warn('Received "done" callback for non-multi-select message', { messageId: parsed.m });
          return;
        }

        const selectedIds = Array.from(pending.selectedActionIds ?? []);
        if (selectedIds.length === 0) {
          await ctx.answerCallbackQuery({ text: 'Please select at least one option' });
          return;
        }

        await ctx.answerCallbackQuery();

        // Clean up pending entry
        pendingInteractiveMsgs.delete(parsed.m);
        if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);

        // Edit original message to show selections (removes keyboard)
        const selectedLabels = selectedIds
          .map((id) => pending.message.actions.find((a) => a.id === id)?.label)
          .filter(Boolean)
          .join(', ');

        try {
          await bot!.api.editMessageText(
            pending.chatId,
            pending.telegramMsgId,
            `${pending.message.text}\n\n✓ ${selectedLabels}`
          );
        } catch (error) {
          log.warn('Could not edit interactive message after multi-select', { messageId: parsed.m, error: String(error) });
        }

        // Route response back to Captain as comma-separated action IDs
        const responseText = selectedIds.join(',');
        captain.sendCaptainMessage(responseText, 'telegram', String(chatId));
        log.info('Multi-select response routed to Captain', { messageId: parsed.m, actionIds: selectedIds, chatId });
        return;
      }

      // Handle action toggle (for multi-select) or action selection (for single-select)
      if (typeof parsed.i === 'number') {
        const selectedAction = pending.message.actions[parsed.i];
        if (!selectedAction) {
          await ctx.answerCallbackQuery();
          log.warn('Interactive callback: action index out of range', { messageId: parsed.m, idx: parsed.i });
          return;
        }

        if (isMultiSelect) {
          // Toggle selection
          const selected = pending.selectedActionIds!;
          if (selected.has(selectedAction.id)) {
            selected.delete(selectedAction.id);
          } else {
            selected.add(selectedAction.id);
          }

          // Update the message to reflect current selection
          const selectedLabels = Array.from(selected)
            .map((id) => pending.message.actions.find((a) => a.id === id)?.label)
            .filter(Boolean)
            .map((label) => `☑ ${label}`)
            .join('\n');

          const displayText = selectedLabels
            ? `${pending.message.text}\n\n${selectedLabels}`
            : pending.message.text;

          // Rebuild keyboard with updated text
          const inlineKeyboard = [
            ...pending.message.actions.map((action, i) => {
              const isSelected = selected.has(action.id);
              return [{
                text: isSelected ? `✓ ${action.label}` : action.label,
                callback_data: JSON.stringify({ m: parsed!.m, i }),
              }];
            }),
            [{
              text: `✅ Done (${selected.size} selected)`,
              callback_data: JSON.stringify({ m: parsed!.m, done: true }),
            }],
          ];

          try {
            await bot!.api.editMessageText(
              pending.chatId,
              pending.telegramMsgId,
              displayText,
              { reply_markup: { inline_keyboard: inlineKeyboard } }
            );
          } catch (error) {
            log.warn('Could not update multi-select message', { messageId: parsed.m, error: String(error) });
          }

          await ctx.answerCallbackQuery({ text: selected.has(selectedAction.id) ? 'Selected' : 'Deselected' });
          return;
        } else {
          // Single-select — finalize immediately
          await ctx.answerCallbackQuery();

          // Clean up pending entry
          pendingInteractiveMsgs.delete(parsed.m);
          if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);

          // Edit original message to show selection (removes keyboard)
          try {
            await bot!.api.editMessageText(
              pending.chatId,
              pending.telegramMsgId,
              `${pending.message.text}\n\n✓ ${selectedAction.label}`
            );
          } catch (error) {
            log.warn('Could not edit interactive message after selection', { messageId: parsed.m, error: String(error) });
          }

          // Route response back to Captain as a regular message
          const responseText = selectedAction.value ?? selectedAction.label;
          captain.sendCaptainMessage(responseText, 'telegram', String(chatId));
          log.info('Interactive response routed to Captain', { messageId: parsed.m, actionId: selectedAction.id, chatId });
          return;
        }
      }
    }

    // Legacy callback handling (existing logic)
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

  knownChatIds.add(chatId);

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

  // Send immediate acknowledgment
  if (bot) {
    const ackMsg = await bot.api.sendMessage(chatId, '⏳');
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
      // Check for numbered options (request_user_input flow) — only these get an inline keyboard
      const numberedOptions = extractNumberedOptions(state.pendingText);
      const lastChunkKeyboard = numberedOptions.length > 0
        ? buildNumberedOptionsKeyboard(numberedOptions)
        : undefined;
      const resolvedOptions: readonly string[] = numberedOptions.length > 0 ? numberedOptions : [];

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
