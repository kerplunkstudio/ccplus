# Discord Integration Design for cc+

Research document for adding a Discord bridge to cc+, following the established Telegram bridge pattern.

---

## Architecture

```
                          cc+ Backend (Node.js)
                    +-------------------------------+
                    |                               |
  Discord API      |   discord-bridge.ts            |
  (Gateway +  <--->|     - Bot client (discord.js)  |
   REST)           |     - Message handler          |
                   |     - Thread manager           |
                   |     - Typing indicator          |
                   |     - Message chunker          |
                   |                               |
                   |   discord-format.ts            |
                   |     - Markdown conversion      |
                   |     - Message splitting (2000) |
                   |     - Embed builder            |
                   |                               |
                   |          |                     |
                   |          v                     |
                   |   captain.ts                   |
                   |     - registerResponseCallback |
                   |     - sendCaptainMessage       |
                   |     - source: 'discord'        |
                   |     - routing: discord:<id>    |
                   |                               |
                   |          |                     |
                   |          v                     |
                   |   Captain (Claude SDK)         |
                   |     - Processes message        |
                   |     - Orchestrates fleet       |
                   |     - Returns response         |
                   +-------------------------------+

  Message Flow:

  1. User sends message in Discord channel/thread
  2. discord-bridge.ts receives via Gateway WebSocket
  3. Allowlist check (user ID or username)
  4. Registers ResponseCallback with captain.ts
  5. Calls sendCaptainMessage(text, 'discord', channelId)
  6. Captain processes, streams response via callback
  7. onText accumulates response text
  8. onComplete formats and sends chunked response back to Discord
  9. Thread created per conversation (optional)

  Slash Commands:

  Discord User ---> /status  ---> captain.sendCaptainMessage("fleet status")
  Discord User ---> /ask     ---> captain.sendCaptainMessage(user input)
  Discord User ---> /clear   ---> Reset conversation context
```

---

## Feature Parity: Telegram vs Discord

| Feature | Telegram Bridge | Discord Equivalent | Notes |
|---------|----------------|-------------------|-------|
| Bot authentication | `CCPLUS_TELEGRAM_BOT_TOKEN` | `CCPLUS_DISCORD_BOT_TOKEN` | Discord uses OAuth2 bot token |
| User allowlist | `CCPLUS_TELEGRAM_ALLOWLIST` (user IDs, usernames) | `CCPLUS_DISCORD_ALLOWLIST` (user IDs, role IDs) | Discord has no stable username; use snowflake IDs or role-based |
| Text messages | `message:text` handler | `messageCreate` event | Nearly identical pattern |
| Voice messages | `message:voice` + whisper transcription | Not in v1 (Discord voice is complex) | Requires @discordjs/voice + opus; defer to v2 |
| Typing indicator | `sendChatAction('typing')` every 4s | `channel.sendTyping()` every 8s | Discord typing expires after 10s; Telegram after 5s |
| Message formatting | MarkdownV2 (custom escaping) | Standard markdown (mostly) | Discord supports **bold**, *italic*, `code`, ```blocks```, ~~strike~~, > quotes, spoilers |
| Message length limit | 4096 characters | 2000 characters | Discord is stricter; need more aggressive chunking |
| Message chunking | Split at paragraph > line > sentence > hard | Same strategy, halved limit | Must also respect code block boundaries |
| Ack message | Sends hourglass emoji, deletes on complete | React with hourglass, remove on complete | Reactions are more idiomatic in Discord |
| Commands | `/start`, `/status`, `/clear` (BotFather) | Slash commands (registered via API) | Discord slash commands have built-in arg parsing |
| Error handling | Plain text error message | Embed with red sidebar | Embeds are more visible in Discord |
| State persistence | `telegram_state.json` (ack message cleanup) | `discord_state.json` (same pattern) | Track pending reaction/ack messages |
| Polling vs WebSocket | Long polling (grammY default) | WebSocket Gateway (discord.js default) | Discord is always WebSocket; no polling option |
| Retry/reconnect | Manual retry with exponential backoff | Built into discord.js Client | discord.js handles reconnection automatically |
| Rate limiting | Manual (grammY handles some) | Built into discord.js REST | discord.js queues requests automatically |
| File attachments | Not implemented | MessageAttachment API | Can send code as file when too long for message |

---

## Discord.js Setup Guide

### Bot Creation

1. Go to https://discord.com/developers/applications
2. Create New Application
3. Go to Bot tab, create bot
4. Copy bot token -> set `CCPLUS_DISCORD_BOT_TOKEN` in `.env`
5. Enable required Privileged Gateway Intents:
   - **Message Content Intent** (required to read message text)
   - **Server Members Intent** (optional, for role-based allowlist)
6. Generate OAuth2 invite URL with scopes: `bot`, `applications.commands`
7. Required bot permissions:
   - Send Messages
   - Send Messages in Threads
   - Create Public Threads
   - Read Message History
   - Add Reactions
   - Manage Messages (to delete own ack messages)
   - Use Slash Commands
   - Embed Links
   - Attach Files

### Required Intents

```typescript
import { Client, GatewayIntentBits, Partials } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // Server info
    GatewayIntentBits.GuildMessages,     // Message events
    GatewayIntentBits.MessageContent,    // Read message text (privileged)
    GatewayIntentBits.DirectMessages,    // DM support
  ],
  partials: [
    Partials.Channel,   // Required for DM handling
    Partials.Message,   // Required for uncached message events
  ],
});
```

### Dependencies

```bash
npm install discord.js    # v14.x (current stable: 14.16+)
```

discord.js v14 requires Node.js 18+. cc+ already targets Node 18+, so no conflict.

No additional native dependencies required (unlike @discordjs/voice which needs libsodium/opus).

### Permission Integer

For the OAuth2 URL, the permissions integer for the above set is: `397821952064`.

---

## Message Formatting Strategy

### Markdown Compatibility

Discord uses a subset of standard markdown that is much simpler than Telegram's MarkdownV2.

| Syntax | Discord Support | Conversion Needed |
|--------|----------------|-------------------|
| `**bold**` | Native | None |
| `*italic*` | Native | None |
| `` `inline code` `` | Native | None |
| ` ```code block``` ` | Native (with language hints) | None |
| `~~strikethrough~~` | Native | None |
| `[text](url)` | Native (auto-embeds suppressed with `<url>`) | None |
| `> blockquote` | Native | None |
| `# Heading` | Native (large text) | May want to convert to **bold** for subtlety |
| Bullet lists | Native (`-` or `*`) | None |
| Numbered lists | Rendered as plain text | None (acceptable) |

**Key insight**: Discord's markdown is much closer to standard markdown than Telegram's MarkdownV2. The `discord-format.ts` file will be significantly simpler -- primarily just message splitting and minor adjustments.

### discord-format.ts Design

```typescript
const DISCORD_MAX_LENGTH = 2000;

// Minimal conversion: Captain output is standard markdown,
// Discord renders most of it natively.
export function formatForDiscord(text: string): readonly string[] {
  const formatted = convertHeadings(text);  // # Heading -> **Heading**
  return splitMessage(formatted, DISCORD_MAX_LENGTH);
}

// Split respecting code block boundaries
export function splitMessage(text: string, maxLength: number): readonly string[] {
  // Same algorithm as telegram-format.ts splitMessage
  // but with code-block-aware splitting:
  // 1. Never split inside a ``` block
  // 2. If a chunk must break a code block, close it and reopen in next chunk
  // 3. Split at paragraph > line > sentence > hard
}
```

### Code Block Splitting

When a code block spans the 2000-char boundary:

```
Chunk 1:                    Chunk 2:
...                         ```typescript
```typescript               // continuation
function long() {           return result;
  // lots of code           }
```                         ```
```

Each chunk must be a valid markdown document. Close ``` in chunk N, reopen with same language tag in chunk N+1.

### Embeds for Rich Content

Use Discord embeds for structured responses:

```typescript
import { EmbedBuilder } from 'discord.js';

// Error responses
const errorEmbed = new EmbedBuilder()
  .setColor(0xFF0000)
  .setTitle('Error')
  .setDescription(message);

// Fleet status
const statusEmbed = new EmbedBuilder()
  .setColor(0x00FF00)
  .setTitle('Fleet Status')
  .addFields(
    { name: 'Active Sessions', value: '3', inline: true },
    { name: 'Queued', value: '1', inline: true },
  );
```

Embeds have a 4096-char description limit and 25 fields max. They do not count against the 2000-char message limit (an embed can accompany a message).

---

## Thread-per-Session Design

Discord threads are the natural mapping for cc+ conversations.

### Strategy

1. **DMs**: No threads needed. Each DM channel is already a 1:1 conversation. Use the channel ID as the routing key (`discord:<channelId>`).

2. **Server channels**: Create a thread for each conversation. This keeps the main channel clean and groups related messages.

### Thread Lifecycle

```
User sends message in #captain channel
  |
  v
Bot creates thread: "Session - <timestamp or summary>"
  |
  v
Bot replies in thread with ack reaction
  |
  v
Captain response posted in thread
  |
  v
Subsequent messages in the same thread route to the same Captain callback
  |
  v
Thread auto-archives after Discord's configured timeout (1h, 24h, 3d, 7d)
```

### Implementation Details

```typescript
// Create thread from a message
const thread = await message.startThread({
  name: `Captain - ${new Date().toLocaleDateString()}`,
  autoArchiveDuration: 60,  // minutes: 60, 1440, 4320, 10080
});

// Routing key: use thread ID once created
const callbackId = `discord:${thread.id}`;
```

### Channel vs Thread Routing

| Context | Routing Key | Behavior |
|---------|-------------|----------|
| DM | `discord:<channelId>` | Direct conversation, no threads |
| Server channel (first message) | Create thread, route to `discord:<threadId>` | New conversation |
| Server thread (subsequent) | `discord:<threadId>` | Continue conversation |
| Slash command in channel | Create thread or reply inline | Depends on command |

### Configuration Options

```env
# Thread behavior
CCPLUS_DISCORD_THREAD_MODE=auto    # auto | never | always
# auto: threads in server channels, direct in DMs
# never: reply inline always
# always: threads everywhere (except DMs)

CCPLUS_DISCORD_THREAD_ARCHIVE_MINUTES=1440  # 60, 1440, 4320, 10080
```

---

## Slash Commands

Discord slash commands provide a better UX than prefix commands and are the modern standard.

### Command Registration

```typescript
import { SlashCommandBuilder, REST, Routes } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask Captain a question')
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Your message to Captain')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show fleet status'),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear conversation context'),
];

// Register on bot startup
const rest = new REST().setToken(token);
await rest.put(Routes.applicationCommands(clientId), { body: commands });
```

### Command Handling

```typescript
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'ask':
      await interaction.deferReply();  // Shows "Bot is thinking..."
      const message = interaction.options.getString('message', true);
      // Route to Captain...
      break;
    case 'status':
      await interaction.deferReply();
      // Route to Captain with fleet status query...
      break;
    case 'clear':
      await interaction.reply({ content: 'Conversation context cleared.', ephemeral: true });
      break;
  }
});
```

**Important**: Slash command interactions must be responded to within 3 seconds. Use `deferReply()` immediately, then `editReply()` when the Captain response is ready. This is analogous to the Telegram ack message pattern.

---

## Edge Cases and Gotchas

### 1. Message Content Intent is Privileged

As of September 2022, bots in 75+ servers need Discord approval for the Message Content intent. For small/personal use this is automatic, but it must be enabled in the Developer Portal. Without it, `message.content` is empty for non-slash-command messages.

**Mitigation**: Support both slash commands (`/ask`) and plain messages. Slash commands always work regardless of intent approval.

### 2. Rate Limits

discord.js handles rate limits internally by queuing requests. However:

- Global rate limit: 50 requests/second
- Per-channel message send: 5 messages/5 seconds
- Typing indicator: 1 per 10 seconds per channel
- Reaction add: 1 per 0.25 seconds

For chunked messages (Captain responses split into 3-4 parts), add a 300ms delay between sends to stay safe. The Telegram bridge already does this with `delay(100)`.

### 3. 2000 Character Limit is Strict

Unlike Telegram (4096), Discord enforces 2000 characters strictly. Captain responses frequently exceed this. The chunking strategy must be robust:

- Average Captain response: 500-2000 chars (usually fine)
- Fleet status reports: 2000-5000 chars (needs splitting)
- Code-heavy responses: 3000-8000 chars (needs splitting with code block awareness)

**Fallback for very long responses**: Attach as a `.md` file if total length exceeds 8000 chars (4+ chunks). This avoids message spam.

### 4. Embed vs Message Limits

| Type | Limit |
|------|-------|
| Message content | 2000 chars |
| Embed description | 4096 chars |
| Embed field value | 1024 chars |
| Total embed chars | 6000 chars |
| Embeds per message | 10 |
| Files per message | 10 |

Using embeds for responses doubles the effective character limit per message. Consider using embed description for the main response text (4096 chars) and message content for a brief summary.

### 5. Thread Archival

Archived threads are still readable but new messages auto-unarchive them. If a user sends a message in an archived thread, Discord auto-unarchives it. This is fine for cc+ -- the bot can resume the conversation.

However, the bot needs `Send Messages in Threads` permission to reply in threads, and `Manage Threads` to unarchive manually if needed.

### 6. DM Handling

Discord bots can receive DMs without being in a shared server (if DMs are enabled). DM channels have no thread support in the same way. For DMs, the routing key should be `discord:dm:<userId>` to separate from server channel messages.

### 7. Multiple Servers

The bot may be in multiple Discord servers. The allowlist should work across all servers. Consider adding server-specific allowlists or a "designated channel" config to restrict where the bot responds.

```env
CCPLUS_DISCORD_CHANNEL_IDS=123456789,987654321  # Only respond in these channels
```

### 8. Bot Mentions

Users may `@mention` the bot instead of using slash commands. Handle this by stripping the mention prefix and treating the rest as a message:

```typescript
// message.content: "<@BOT_ID> what is the fleet status?"
// Strip mention: "what is the fleet status?"
const text = message.content.replace(/<@!?\d+>/g, '').trim();
```

### 9. Interaction Timeout

Slash command interactions expire after 15 minutes. If Captain takes longer than 15 minutes to respond (unlikely but possible for complex operations), `editReply()` will fail. The bot should fall back to sending a new message in the channel/thread.

### 10. Reconnection

discord.js handles WebSocket reconnection automatically with exponential backoff. Unlike the Telegram bridge, no custom retry logic is needed for the connection itself. However, the bot should handle the `shardDisconnect` and `shardReconnecting` events for logging.

### 11. Concurrent Message Handling

Multiple users may message the bot simultaneously. Each conversation needs its own `ChatState` and `callbackId`, exactly as the Telegram bridge does with `chatStates` Map. The key difference: in Discord, use `channelId` or `threadId` (not `chatId`) as the state key.

---

## Phased Implementation Plan

### Phase 1: Core Bridge (MVP)

**Goal**: Feature parity with Telegram bridge for text messages.

Files to create:
- `backend-ts/src/discord-bridge.ts` -- Main bridge (mirrors `telegram-bridge.ts`)
- `backend-ts/src/discord-format.ts` -- Message formatting (simpler than Telegram)

Files to modify:
- `backend-ts/src/server.ts` -- Add auto-start for Discord bridge (same pattern as Telegram)
- `backend-ts/src/config.ts` -- Already has `DISCORD_BOT_TOKEN` and `DISCORD_ALLOWLIST`

What it includes:
- discord.js Client with required intents
- `messageCreate` handler for plain text messages
- User allowlist check (by Discord user ID)
- Typing indicator loop (every 8 seconds)
- Ack reaction (hourglass on received message, remove on complete)
- Captain callback registration (`discord:<channelId>`)
- Response accumulation in `onText`, send in `onComplete`
- Message chunking at 2000 chars with code-block awareness
- Graceful start/stop lifecycle
- State persistence for cleanup on restart

### Phase 2: Slash Commands + Threads

**Goal**: Discord-native UX with slash commands and thread-per-conversation.

What it includes:
- `/ask`, `/status`, `/clear` slash commands
- `deferReply()` for immediate acknowledgment
- Thread creation for server channel conversations
- Thread-aware routing (`discord:<threadId>`)
- DM support without threads

### Phase 3: Rich Formatting + Attachments

**Goal**: Polish the experience with Discord-specific features.

What it includes:
- Embed-based error messages (red sidebar)
- Embed-based fleet status (structured fields)
- Long response -> file attachment fallback
- Bot mention handling (`@Captain what is...`)
- Channel restriction config (`CCPLUS_DISCORD_CHANNEL_IDS`)

### Phase 4: Advanced Features (Future)

**Goal**: Features beyond Telegram bridge parity.

What it includes:
- Reaction-based controls (thumbs up to approve, X to cancel)
- Button components for common actions (approve session, view logs)
- Select menus for session selection
- Voice channel integration (join, listen, transcribe)
- Webhook mode for high-throughput notifications (fleet events -> channel)

---

## Configuration Summary

```env
# Required
CCPLUS_DISCORD_BOT_TOKEN=         # Bot token from Developer Portal

# Optional
CCPLUS_DISCORD_ALLOWLIST=         # Comma-separated user IDs or role IDs
CCPLUS_DISCORD_CHANNEL_IDS=       # Restrict to specific channels (empty = all)
CCPLUS_DISCORD_THREAD_MODE=auto   # auto | never | always
```

The `CCPLUS_DISCORD_BOT_TOKEN` and `CCPLUS_DISCORD_ALLOWLIST` config values already exist in `config.ts`.

---

## Open Questions

1. **Role-based access**: Should the allowlist support Discord role IDs in addition to user IDs? This would allow "anyone with the @Developer role can use Captain" without listing individual IDs.

2. **Multi-server isolation**: If the bot is in multiple servers, should each server have its own Captain context, or share one?

3. **Notification channel**: Should fleet events (session complete, session failed) be broadcast to a designated Discord channel? This would be a one-way notification, not a conversation.

4. **Ephemeral replies**: Should `/status` respond ephemerally (only visible to the caller) or publicly? Ephemeral reduces channel noise but prevents team visibility.

5. **Message edit vs new message**: When Captain's response is short enough for one message, should the bot edit the ack/deferred reply or send a new message? Editing is cleaner; new message preserves history.
