# cc+ Deep Audit Findings

> Generated: 2026-03-29. All findings are based on direct code inspection — no speculation.

---

## Bugs

---

### BUG-01: Hardcoded `BYPASS_PERMISSIONS = true` — cannot be disabled via env at startup

**What**: `BYPASS_PERMISSIONS` is hardcoded `true` as a module-level `const` in `config.ts`. The `reloadConfig()` handler can change the runtime value via `CCPLUS_BYPASS_PERMISSIONS`, but the exported constant itself never changes. Any code that imports `BYPASS_PERMISSIONS` directly (rather than calling `getBypassPermissions()`) always gets `true`.

**Where**: `backend-ts/src/config.ts:83`

```ts
export const BYPASS_PERMISSIONS = true;  // hardcoded, never reads env
```

**Severity**: Medium

**Evidence**: Two parallel exports exist — the hardcoded `const` and the `runtimeConfig` copy. `sdk-session.ts` and `captain.ts` import the const directly, so env-based override never takes effect for those callers.

---

### BUG-02: Scheduler heartbeat design is implicit and confusing

**What**: `SchedulerImpl.start()` creates a `setInterval` whose callback is empty (`// Tick is handled externally`). The interval fires on schedule but does nothing — the actual scheduling work is driven by `runDueTasksNow()` called directly from `server.ts:371`. The heartbeat exists solely to keep the interval ID alive, but the empty callback body makes the design intention unclear. This is a code clarity issue, not a functional bug.

**Where**: `backend-ts/src/scheduler.ts:156-161`, `backend-ts/src/server.ts:371,84-87`

**Severity**: Low (code clarity/design issue)

**Evidence**:
```ts
// scheduler.ts:156-161
this.intervalId = setInterval(() => {
  // Tick is handled externally (in server.ts)
  // This is just a heartbeat for logging
}, this.tickIntervalMs);

// server.ts:371 — scheduler.start() IS called
scheduler.start();

// server.ts:84-87 — actual scheduling work is manual
setInterval(() => {
  scheduler.runDueTasksNow();
}, 60 * 1000);
```

---

### BUG-03: Fleet session pruner never started in production

**What**: `fleetMonitor.startPruner()` is only called in tests (via `_clearSessions` teardown path). In `server.ts`, `startZombieReaper()` and `startStuckDetector()` are called at startup, but `startPruner()` is missing. Completed/failed sessions therefore accumulate in memory indefinitely.

**Where**: `backend-ts/src/server.ts:85-89`, `backend-ts/src/fleet-monitor.ts:394-404`

**Severity**: Medium

**Evidence**:
```ts
// server.ts startup — missing startPruner():
fleetMonitor.loadSessionsFromDb();
fleetMonitor.startZombieReaper();
fleetMonitor.startStuckDetector();
// fleetMonitor.startPruner() is absent
```

---

### BUG-04: Telegram race condition — concurrent messages overwrite chat state

**What**: If two Telegram messages arrive for the same `chatId` before the first response completes, `handleMessageById` overwrites `chatStates` with a fresh state (zeroing `sentMessageIds`, `pendingText`, `ackMessageId`). The first message's in-flight `onText`/`onComplete` callbacks still hold the old `chatId` closure, and will attempt to flush/edit messages that are now orphaned. The second message also sends a new `⏳` ack, resulting in duplicate ack messages.

**Where**: `backend-ts/src/telegram-bridge.ts:654-665`

```ts
const newState: ChatState = {
  callbackId,
  pendingText: '',
  typingInterval,
  ackMessageId: null,     // wipes any existing ack message reference
  flushTimer: null,
  sentMessageIds: [],     // wipes any partially-sent messages
  lastSentText: '',
};
chatStates.set(chatId, newState);   // unconditionally replaces existing state
```

**Severity**: Medium

**Evidence**: No guard against a concurrent in-flight response for the same chatId before resetting state.

---

### BUG-05: `handleResponseText` accumulates all Captain messages unconditionally

**What**: `handleResponseText` appends every `onText` event to `pendingText` with `\n\n` separator. Captain's `processQueryResponse` emits one `onText` call per assistant `result` message. For multi-turn conversations with thinking blocks or intermediate tool results, this can produce a single merged blob sent to the user rather than discrete messages.

**Where**: `backend-ts/src/telegram-bridge.ts:826-831`

```ts
chatStates.set(chatId, {
  ...state,
  pendingText: state.pendingText ? state.pendingText + '\n\n' + text : text,
  flushTimer,
});
```

**Severity**: Low (UX degradation rather than data loss)

---

### BUG-06: Expired interactive message text is hardcoded in Spanish ("Expirado")

**What**: When a Telegram interactive message times out, the replacement text is hardcoded as `'Expirado'` (Spanish for "Expired"). The rest of the codebase is in English.

**Where**: `backend-ts/src/telegram-bridge.ts:179`

```ts
await bot.api.editMessageText(pending.chatId, pending.telegramMsgId, 'Expirado');
```

**Severity**: Low (localization bug)

---

### BUG-07: `console.log` in production code — bypasses structured logger

**What**: `fleet-monitor.ts` uses a bare `console.log` instead of the structured `log` utility. This means the pruner log line is not JSON-structured and will not be captured correctly by any log aggregator reading the JSON output.

**Where**: `backend-ts/src/fleet-monitor.ts:419`

```ts
console.log(`[fleet-monitor] Pruned ${pruneCount} old terminal session(s) from memory`);
```

Additionally, `backend-ts/src/sdk/skills.ts` has 9 bare `console.error` calls (lines 19, 41, 56, 84, 98, 112, 128, 147, 180) that bypass the structured logger.

**Severity**: Low

---

### BUG-08: `getAllFleetSessions` loads ALL fleet sessions with no limit

**What**: `getAllFleetSessions()` (called on startup) issues a `SELECT * FROM fleet_sessions ORDER BY started_at DESC` with no `LIMIT`. A long-running instance with thousands of historical sessions will load them all into memory at startup.

**Where**: `backend-ts/src/db/fleet-sessions.ts:44-48`

**Severity**: Medium (performance/memory issue for long-running instances)

**Evidence**:
```ts
const rows = d.prepare(`
  SELECT * FROM fleet_sessions
  ORDER BY started_at DESC
`).all() as Array<...>;
```

---

### BUG-09: Captain conversation ID fragmentation — each message with no prior history creates a new conversation ID

**What**: `sendCaptainMessage` falls back to `captain-conv-${Date.now()}` if `getLatestCaptainConversationId()` returns null. This only happens on the very first message, but if the database is wiped or the captain_messages table is empty, every message restart creates a new conversation ID because the previous call to `sendCaptainMessage` inserted a user message, but `getLatestCaptainConversationId()` is re-queried for the assistant response in `processQueryResponse`. Between the two DB calls the same ID is used, but if the first user message insert fails silently, the next query may create a new ID. Not a consistent bug but creates orphaned conversations.

**Where**: `backend-ts/src/captain.ts:370-374`, `backend-ts/src/captain.ts:281-288`

**Severity**: Low

---

### BUG-10: `decodeFolderPath` in session-import loses paths with legitimate hyphens

**What**: The folder-path decoder in `session-import.ts` converts ALL hyphens to slashes after the leading slash. A project like `/Users/john-doe/Workspace` stored as `-Users-john-doe-Workspace` will be decoded as `/Users/john/doe/Workspace`, which does not exist. The code has a comment acknowledging the ambiguity but does not resolve it.

**Where**: `backend-ts/src/session-import.ts:87-104`

```ts
const decoded = '/' + folderName.slice(1).replace(/-/g, '/');
```

**Severity**: Medium (session import silently uses wrong project path for users with hyphens in their home directory components)

---

### BUG-11: `whisperConfigWarningShown` flag prevents `WHISPER_MODEL_PATH` warning from ever showing

**What**: In `voice-transcriber.ts`, the `ffmpegConfigWarningShown` flag is set to `true` on line 110 if `FFMPEG_PATH` is unset. Then on line 147, the code checks `!whisperConfigWarningShown` to warn about `WHISPER_MODEL_PATH` being unset — but since both flags are named differently, if ffmpeg runs fine and sets `ffmpegConfigWarningShown = true`, the whisper model path warning is gated on `whisperConfigWarningShown` which is a separate variable. This is not a bug per se, but the two separate flags have identical semantics and the naming (`whisperConfigWarningShown` used for BOTH ffmpeg config AND whisper config separately) is confusing and error-prone.

**Where**: `backend-ts/src/voice-transcriber.ts:108-149`

**Severity**: Low (code clarity)

---

## Architectural / Design Findings

---

### ARCH-01: Captain conversation history does NOT persist across restarts

**What**: The `sdkSessionId` is stored in `captain_state.json` via `state-persistence.ts` and reloaded at startup to allow the SDK to resume from the last conversation turn. However, the Captain's in-memory `captainState.messageCount` resets to 0 on restart, and the conversation history displayed in the UI comes from `captain_messages` table — which IS persisted. The conversation *context* (via `sdkSessionId`) is preserved, but the Captain has no built-in summary of the previous session unless Claude's own context window retains it. If the SDK session has expired (rolling 30-day window), the resume silently starts a fresh context.

**Where**: `backend-ts/src/captain.ts:179`, `backend-ts/src/state-persistence.ts`

**Severity**: Medium — documented but not surfaced to users

---

### ARCH-02: Scheduler tasks are not persisted — lost on server restart

**What**: `SchedulerImpl` stores all tasks in an in-memory `Map`. There is no database table for scheduled tasks and no save/restore on startup/shutdown. All scheduled tasks are silently lost on server restart.

**Where**: `backend-ts/src/scheduler.ts:30-35`

**Severity**: High (data loss on restart — user-created schedules vanish)

---

### ARCH-03: Fleet session `stuckDetectedAt` is not persisted in the database schema

**What**: `FleetSessionInfo` has a `stuckDetectedAt?: number` field, but `upsertFleetSession` in `fleet-sessions.ts` does not write this field to the DB (it's not in the INSERT/REPLACE column list). On restart, sessions loaded from DB will never have `stuckDetectedAt` set, meaning a session that was already detected as stuck will trigger the stuck callback again on restart.

**Where**: `backend-ts/src/db/fleet-sessions.ts:4-41`, `backend-ts/src/fleet-monitor.ts:7-23`

**Severity**: Medium

---

### ARCH-04: Cost tracking only covers imported sessions and query_usage table — not surfaced in fleet monitor

**What**: The `fleet_sessions` table stores `input_tokens` and `output_tokens` but NOT `cost_usd`. Cost calculation logic exists in `session-import.ts` (using `MODEL_PRICING_PREFIXES`) for imported sessions and in `sdk-session.ts` via `recordQueryUsage`. However, `FleetSessionInfo` has no cost field, so the fleet monitor dashboard cannot show estimated spend per session. The `query_usage` table is the canonical cost source but there is no API to aggregate cost by fleet session.

**Where**: `backend-ts/src/fleet-monitor.ts:7-23`, `backend-ts/src/db/fleet-sessions.ts`, `backend-ts/src/session-import.ts:62-78`

**Severity**: Medium (missing feature)

---

### ARCH-05: Migration v2 runs an `ALTER TABLE ... ADD COLUMN description` that is already included in migration v1's schema

**What**: Migration v1 creates `tool_usage` with a `description TEXT` column (line 74). Migration v2 attempts to `ALTER TABLE tool_usage ADD COLUMN description TEXT`. The migration runner has a guard for `duplicate column name` errors, so this silently no-ops for all installs that started from v1. However, the migration is logically incorrect and misleading.

**Where**: `backend-ts/src/db/migrations.ts:107-113`

**Severity**: Low (harmless but incorrect)

---

### ARCH-06: `getConversationHistory` uses `ORDER BY timestamp ASC` with no index coverage for the full ORDER

**What**: The index `idx_conversations_session` covers `(session_id, timestamp)`. The query also orders by `id ASC` as a tiebreaker, but `id` is not in the index. For sessions with many messages (>50 rows), SQLite must sort the full result set. A similar issue applies to `getToolEvents` which orders by `(timestamp DESC, id DESC)`.

**Where**: `backend-ts/src/db/messages.ts:35-42`, `backend-ts/src/db/tool-events.ts:69-76`

**Severity**: Low (performance, only matters at scale)

---

### ARCH-07: `pendingInteractiveMessages` in captain.ts are lost on restart

**What**: `pendingInteractiveMessages` is an in-memory Map. Any interactive messages waiting for user response (e.g., Telegram inline keyboard) that are unresolved at shutdown are lost. After restart, the timeout timer is gone and the promise can never resolve. The pending Telegram message remains clickable but clicking it will hit `pendingInteractiveMsgs.get(...)` in `telegram-bridge.ts` and return "This message has expired" — which is actually the correct user-facing behavior, but the internal `resolve` callback is leaked and never called, leaving the promise hanging.

**Where**: `backend-ts/src/captain.ts:50-54`

**Severity**: Low (minor resource leak, correct UX behavior)

---

## Security

---

### SEC-01: Telegram allowlist is empty by default — open to any Telegram user

**What**: If `CCPLUS_TELEGRAM_ALLOWLIST` is not set, `config.TELEGRAM_ALLOWLIST` is an empty array. `isAllowed()` returns `true` for any user when the allowlist is empty. The server logs a warning (`Telegram bridge running without allowlist`) but still proceeds. Any Telegram user who discovers the bot can send commands to Captain, which can start sessions, run tools, and execute code.

**Where**: `backend-ts/src/config.ts:113-114`, `backend-ts/src/telegram-bridge.ts:613-621`

**Severity**: High (for any deployment that enables Telegram without configuring the allowlist)

**Evidence**:
```ts
function isAllowed(ctx: Context): boolean {
  if (config.TELEGRAM_ALLOWLIST.length === 0) return true;  // open to all
  ...
}
```

---

### SEC-02: Telegram bot token stored in `settings.json` as plaintext

**What**: The settings persistence layer (`config.ts`) allows writing `integrations.telegram.bot_token` to `data/settings.json`. This file is not in `.gitignore` (the `data/` directory is, so it is protected from commits), but in any scenario where `settings.json` is backed up, exported, or read by a third party, the bot token is exposed.

**Where**: `backend-ts/src/config.ts:200-206`

**Severity**: Low (mitigated by `data/` gitignore, but worth noting)

---

## Dead Code / Unused Features

---

### DEAD-01: `captain-queue.ts` is fully implemented but never imported

**What**: `captain-queue.ts` defines a complete `CaptainQueue` async iterator with `push()`, `close()`, and `[Symbol.asyncIterator]()`. However, `captain.ts` does not import or use it — Captain uses the `query()` SDK API directly with `resume` for conversational continuity, not a push-queue architecture. The queue file appears to be from an earlier design that was superseded.

**Where**: `backend-ts/src/captain-queue.ts`

**Severity**: Low (dead code, ~105 lines)

**Verification**: `grep -r "captain-queue" backend-ts/src/` returns 0 results outside of the file itself and tests.

---

### DEAD-02: `archiveCaptainConversation` is a documented no-op

**What**: `archiveCaptainConversation()` has a comment saying it's a "no-op placeholder for future use". It is exposed in `db/captain-messages.ts` and re-exported from `db/index.ts` but the function body is empty and it is not called anywhere in the codebase.

**Where**: `backend-ts/src/db/captain-messages.ts:98-101`

**Severity**: Low (dead code, 4 lines)

---

### DEAD-03: `startPruner()` exported from `fleet-monitor.ts` but never called in server

**What**: As noted in BUG-03, `startPruner` is exported and has tests, but is never called in the production server startup path. This is simultaneously a bug (sessions accumulate) and dead code (the export is effectively unused in production).

**Where**: `backend-ts/src/fleet-monitor.ts:394-398`

---

## Priority Summary

| ID | Severity | Category | Fix Effort |
|----|----------|----------|------------|
| SEC-01 | High | Security | Low |
| ARCH-02 | High | Data loss | High |
| BUG-08 | Medium | Performance | Low |
| BUG-01 | Medium | Config | Low |
| BUG-03 | Medium | Memory leak | Low |
| BUG-04 | Medium | Race condition | Medium |
| ARCH-01 | Medium | UX | Medium |
| ARCH-03 | Medium | Data integrity | Low |
| ARCH-04 | Medium | Missing feature | Medium |
| BUG-10 | Medium | Import | Medium |
| BUG-05 | Low | UX | Low |
| BUG-06 | Low | i18n | Trivial |
| BUG-07 | Low | Logging | Trivial |
| BUG-09 | Low | DB integrity | Low |
| BUG-11 | Low | Code clarity | Trivial |
| BUG-02 | Low | Code clarity | Low |
| ARCH-05 | Low | Migration | Trivial |
| ARCH-06 | Low | Performance | Low |
| ARCH-07 | Low | Resource leak | Low |
| DEAD-01 | Low | Dead code | Low |
| DEAD-02 | Low | Dead code | Trivial |
| DEAD-03 | Low | Dead code | Low |
| SEC-02 | Low | Security | Low |
