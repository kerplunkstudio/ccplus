# Captain Context Window Management — Analysis & Proposal

**Date:** 2026-03-29
**Status:** Draft — for implementation

---

## 1. Current State

### How Captain Handles Context Today

Captain is a persistent, stateful orchestrator session built on top of the Claude Agent SDK. Unlike regular sessions that are short-lived, Captain is intended to run indefinitely. Its context accumulates across every user message, fleet event, and tool call.

**Session lifecycle (`backend-ts/src/captain.ts`):**

- `startCaptainSession()` (line 124) creates one boot query with a `bootMessage` prompt.
- Every subsequent user or fleet message calls `startCaptainQuery()` (line 416), which issues a new SDK `query()` with `resume: captainState.sdkSessionId`.
- The SDK resume mechanism loads the full conversation history from `~/.claude/projects/<project-dir>/<sdkSessionId>.jsonl` on each query.
- There is **no token counting, no context limit check, no compaction trigger, and no session rotation** anywhere in `captain.ts`, `captain-prompt.ts`, `captain-tools.ts`, or `captain-router.ts`.

**SDK session ID persistence (`backend-ts/src/state-persistence.ts`):**

- After each query's `result` message, the `sdkSessionId` returned from the SDK is saved to `data/captain_state.json`.
- On server restart, `CAPTAIN_RESUME_ON_STARTUP` (default: `true`) re-attaches to the same JSONL transcript, picking up the full conversation history where it left off.

**System prompt size:**

The Captain system prompt (`captain-prompt.ts:53`) is approximately 3,500–5,000 tokens depending on workflow and agent catalog content. It is dynamically rebuilt every 60 seconds from:
- `CAPTAIN_SYSTEM_PROMPT_TEMPLATE` (~2,800 tokens)
- Available workflows section (variable, ~100–300 tokens)
- Agent catalog section (variable, ~200–600 tokens)
- Phase enforcement section (variable, ~100–300 tokens)

**Model:**

Captain defaults to `claude-opus-4-6` (`config.ts:104`). This model has a **1,000,000 token context window**. While the SDK reports `contextWindow: 200,000` in its internal metadata, that value represents the Claude Code agent's default working limit, not the actual model capacity. The real context limits are defined in `stream-query.ts:487-491` and confirmed in commit 0d4d886: Opus 4.6 and Sonnet 4.6 both support 1M tokens natively.

**Token tracking:**

Regular sessions in `stream-query.ts` (lines 476–499) track input tokens from the SDK result's `usage` field and the `message_stop` streaming event. Captain's `processQueryResponse()` does NOT extract token usage from result messages — it only reads `result.session_id` and `result.num_turns` (lines 293–312). **Captain has no awareness of its own token consumption.**

**Error handling at context limit:**

There is a generic `catch (error)` block in `processQueryResponse()` (line 327) that logs the error and calls `callback.onError(String(error))`. If the SDK returns a context overflow error, it will be caught here and sent to registered callbacks as a string error. The session is NOT restarted. `captainState.activeQuery` is set to null in `finally`, and the SDK session ID is retained — meaning the next `sendCaptainMessage()` will attempt to resume the same (now overflowed) conversation, causing repeated failures until the server restarts and `CAPTAIN_RESUME_ON_STARTUP` loads fresh state.

---

## 2. SDK Capabilities for Context Management

### What the SDK Provides

**Auto-compaction (built-in):**

The SDK has a built-in auto-compact mechanism. Evidence from `sdk.d.ts`:
- `SDKStatus = 'compacting' | null` (line 2226) — the SDK emits status messages when compacting.
- `SDKCompactBoundaryMessage` (line 1666) — emitted with `subtype: 'compact_boundary'` when auto-compaction occurs, including `pre_tokens`, `trigger: 'manual' | 'auto'`, and optional `preserved_segment`.
- `PreCompact` / `PostCompact` hook events (line 466) — fire before and after compaction with `compact_summary` in PostCompact.
- `SessionStartHookInput.source` can be `'compact'` (line 2386) — new session starts from a compacted state.

The existing `stream-query.ts` already handles `compact_boundary` messages (lines 589–597): it flushes memory before compaction and calls `callbacks.onCompactBoundary?.()`. **Captain's `processQueryResponse()` does not handle `compact_boundary` messages at all.**

**No explicit "set context limit" option in `query()` Options:**

The SDK `Options` type (line 744–1225) has no `maxContextTokens`, `compactionThreshold`, or similar option. Auto-compaction is controlled by the SDK internally and fires automatically when the context window approaches capacity.

**`betas` option:**

`Options.betas?: SdkBeta[]` where `SdkBeta = 'context-1m-2025-08-07'` (line 1664). Enabling this increases the context window from 200k to 1M tokens for Sonnet 4/4.5. Note: this is documented for Sonnet 4/4.5, not Opus 4.6 — confirmation would be needed before applying to Captain.

**`persistSession` option:**

`Options.persistSession?: boolean` (line 934). Defaulting to `true`, which is why Captain's JSONL file grows unboundedly. Setting to `false` would disable all persistence — too destructive.

**`forkSession` option:**

`Options.forkSession?: boolean` (line 884). When `resume` is set and `forkSession: true`, the resumed session is forked to a new session ID. This is a session rotation mechanism: you resume the old context (triggering auto-compact from the SDK side), then the result's `session_id` is a new ID. Subsequent queries use the new ID. This is the SDK's sanctioned session rotation path.

---

## 3. Token Burn Rate Estimate

This is based on structural analysis since no token logging exists for Captain today.

### Per-query cost model

Each Captain query involves:

| Component | Token estimate |
|---|---|
| System prompt (cached after first query) | ~4,000 tokens (cache hit = ~400 tokens billed) |
| Full conversation history (grows linearly) | N × avg_message_tokens |
| User message (varies by source) | 50–500 tokens |
| Fleet event message | 50–200 tokens |
| Tool results (fleet-control MCP responses) | 200–2,000 tokens per tool call |
| Captain assistant response | 100–500 tokens |

Estimated average message size: ~500 input tokens per exchange (user + previous assistant + tool results), ~200 output tokens.

**Growth rate:**

At 20 messages/day (moderate usage: developer + Telegram + fleet events):
- Day 1: ~10,000 tokens in history
- Day 7: ~70,000 tokens
- Day 14: ~140,000 tokens
- Day 70: ~700,000 tokens

At heavy usage (50+ messages/day plus fleet events from many parallel sessions), the 1M limit could be reached within 15–20 days.

**SDK auto-compact trigger:**

The SDK's auto-compact fires when the context window is ~95% full (inferred from industry practice and the `pre_tokens` field in `SDKCompactBoundaryMessage`). For Opus 4.6 at 1M:
- Auto-compact threshold: ~950,000 tokens
- After compact: Claude summarizes the conversation, the summary replaces history
- Post-compact context: ~5,000–20,000 tokens (summary + recent messages)
- The conversation can continue indefinitely with repeated compactions

**The critical gap:** If auto-compaction triggers mid-query for Captain, `processQueryResponse()` will emit `compact_boundary` as an unhandled message type, silently ignore it, and continue. The SDK will have created a new session ID (from the compacted state), which Captain will store in `captainState.sdkSessionId`. This part works. However, Captain has no visibility into when compaction happened, cannot log it, and cannot proactively manage the cycle.

---

## 4. Proposed Solution

### Recommendation: Enable SDK Auto-Compaction + Add Context Visibility

The SDK's auto-compact handles the fundamental problem. The work needed is:
1. Handle `compact_boundary` messages in Captain's response loop (matches what `stream-query.ts` already does).
2. Track token usage from Captain's result messages (to expose health metrics).
3. Add a `CAPTAIN_CONTEXT_RESET_THRESHOLD` config option for proactive session rotation when auto-compact is insufficient or fails.

This is the minimal, lowest-risk approach. It avoids rebuilding the session lifecycle.

### Implementation Plan

#### Phase 1: Handle compact_boundary and track tokens (2–3 hours)

**File: `backend-ts/src/captain.ts`**

In `processQueryResponse()`, add handling for `compact_boundary` and `result` token extraction after the `message.type === 'result'` block:

```typescript
// In processQueryResponse(), add inside the for-await loop:

} else if (message.type === 'system' && (message as any).subtype === 'compact_boundary') {
  const msg = message as any;
  const preTokens = msg.compact_metadata?.pre_tokens ?? 0;
  log.info('Captain context compacted', {
    sessionId,
    preTokens,
    trigger: msg.compact_metadata?.trigger ?? 'auto',
  });

} else if (message.type === 'result') {
  const result = message as any;
  // ... existing sdkSessionId persistence code ...

  // NEW: extract token usage
  const usageObj = result.usage ?? {};
  const inputTokens = (usageObj.input_tokens || 0)
    + (usageObj.cache_read_input_tokens || 0)
    + (usageObj.cache_creation_input_tokens || 0);

  if (inputTokens > 0) {
    captainState = {
      ...captainState,
      lastInputTokens: inputTokens,
      totalInputTokens: captainState.totalInputTokens + inputTokens,
    };
    log.info('Captain token usage', {
      sessionId,
      inputTokens,
      contextPct: Math.round((inputTokens / CAPTAIN_CONTEXT_WINDOW) * 100),
    });
  }
}
```

Add to `CaptainState` interface:
```typescript
interface CaptainState {
  // ... existing fields ...
  readonly lastInputTokens: number;
  readonly totalInputTokens: number;
}
```

Add to initial state and `startCaptainSession` reset:
```typescript
lastInputTokens: 0,
totalInputTokens: 0,
```

Expose in `getCaptainStatus()`:
```typescript
export function getCaptainStatus() {
  return {
    active,
    sessionId: captainState.sessionId,
    uptimeMs,
    messageCount: captainState.messageCount,
    lastInputTokens: captainState.lastInputTokens,
    totalInputTokens: captainState.totalInputTokens,
    contextPct: captainState.lastInputTokens > 0
      ? Math.round((captainState.lastInputTokens / CAPTAIN_CONTEXT_WINDOW) * 100)
      : null,
  };
}
```

**File: `backend-ts/src/config.ts`**

Add:
```typescript
export const CAPTAIN_CONTEXT_WINDOW = 1_000_000; // Opus 4.6 native context
export const CAPTAIN_CONTEXT_RESET_THRESHOLD = parseInt(
  process.env.CCPLUS_CAPTAIN_CONTEXT_RESET_THRESHOLD ?? '900000',
  10,
);

**Note:** This document originally stated 200,000 tokens based on the SDK's reported `contextWindow` value. However, `stream-query.ts:487-491` shows the actual model capacity is 1,000,000 tokens for Opus 4.6. The SDK's 200k value represents an internal agent working limit, not the model's native context. All token estimates in this document have been updated to reflect the correct 1M limit (commit 0d4d886 confirms this).
```

#### Phase 2: Proactive session rotation at threshold (optional, 1–2 hours)

When `lastInputTokens > CAPTAIN_CONTEXT_RESET_THRESHOLD` AND context has not already been compacted in this query (detected by checking if `sdkSessionId` changed), initiate rotation:

```typescript
// In processQueryResponse(), after token extraction in 'result' handler:

if (
  captainState.lastInputTokens > config.CAPTAIN_CONTEXT_RESET_THRESHOLD
  && captainState.sessionId
) {
  log.warn('Captain approaching context limit — rotating session', {
    sessionId,
    inputTokens: captainState.lastInputTokens,
    threshold: config.CAPTAIN_CONTEXT_RESET_THRESHOLD,
  });
  // Schedule rotation after current query finishes (non-blocking)
  setImmediate(() => rotateSessionIfNeeded());
}
```

`rotateSessionIfNeeded()` would call `startCaptainQuery()` with `forkSession: true` in the options, causing the SDK to fork the current session (with its compacted state) to a new `sdkSessionId`. The next query will use the forked session ID.

**Note:** `forkSession` in SDK's `query()` Options is only valid alongside `resume`. The Captain already passes `resume: captainState.sdkSessionId ?? undefined`, so adding `forkSession: true` when rotation is needed is valid.

#### Phase 3: Expose context health in API (optional, 30 minutes)

`GET /api/captain/status` already returns the output of `getCaptainStatus()`. After Phase 1, this will include `lastInputTokens`, `totalInputTokens`, and `contextPct`. No router changes needed.

---

## 5. Alternatives Considered

### Option A: Manual conversation windowing (keep last N messages)

**Approach:** Store Captain messages in the DB (already done in `captain-messages.ts`). Before each query, reconstruct the conversation from the last N DB messages instead of resuming the SDK session.

**Problem:** The SDK's `resume` mechanism does more than load messages — it also restores tool call state, intermediate assistant messages, and compaction metadata from the JSONL file. Bypassing resume means losing this. Additionally, reconstructing messages in the exact SDK format (`SDKUserMessage`, `SDKAssistantMessage`) is undocumented and fragile.

**Verdict:** Rejected. The SDK was not designed for this, and the implementation would be brittle against SDK upgrades.

### Option B: Periodic summarization via a Haiku summarization pass

**Approach:** Every N messages, send the conversation history to a cheap model (Haiku) to produce a summary, then inject the summary as a system message in a fresh `query()` without `resume`.

**Problem:** Starting without `resume` means breaking the MCP server state (the fleet-control `createSdkMcpServer` singleton). The MCP server holds no in-memory tool state, so this is recoverable, but the fresh query would lose the SDK's awareness of pending tool calls or interrupted sequences. Also, this doubles the cost of every message near the threshold.

**Verdict:** Viable as a last resort but adds complexity. The SDK auto-compact already does the summarization — building a manual duplicate is unnecessary.

### Option C: Hard session rotation on a message count limit

**Approach:** Every 100 messages, call `startCaptainSession()` as if starting fresh, ignoring the old `sdkSessionId`.

**Problem:** Captain would lose all conversation context, tool state, and memory of prior interactions. Users would notice immediately. Fleet events in-flight at the time of rotation would lose their routing callbacks.

**Verdict:** Rejected. Too disruptive.

### Option D: Enable 1M context beta

**Approach:** Add `betas: ['context-1m-2025-08-07']` to the Captain `query()` options in `startCaptainSession()` and `startCaptainQuery()`.

**Problem:** The SDK documentation describes this beta for Sonnet 4/4.5, not Opus 4.6. Captain defaults to Opus 4.6. Applying an unsupported beta flag may cause API errors or silently have no effect. Additionally, 1M context is not indefinite — at heavy usage it still requires eventual compaction or rotation.

**Verdict:** Worth investigating for the future if Opus 4.6 supports it, but not the primary fix. Auto-compact + rotation is the correct long-term solution regardless.

### Option E: SDK auto-compact only (no changes)

**Approach:** Do nothing. The SDK's built-in auto-compact will fire before overflow. The `compact_boundary` message is silently ignored, the `sdkSessionId` updates in `captainState`, and the conversation continues.

**Problem:** This mostly works today, but:
1. Captain has no logging or metrics about compaction events.
2. The `getCaptainStatus()` API returns `messageCount` but not `contextPct` — operators cannot see if Captain is approaching limits.
3. If auto-compact fails (API error during compaction), the next query attempt will fail with a context overflow error and Captain's error recovery (line 327) will retry against the same overflowed session ID repeatedly until the server restarts.

**Verdict:** Acceptable as a short-term stance but insufficient for production reliability. Phase 1 of the recommended solution addresses this at minimal cost.

---

## 6. Trade-offs and Risks

| Approach | Implementation Cost | Risk | Resilience Gain |
|---|---|---|---|
| Phase 1: compact_boundary handling + token tracking | Low (1–2 hours) | Very low | High (visibility, logging) |
| Phase 2: Proactive rotation at threshold | Medium (2–3 hours) | Low (uses SDK forkSession) | High (prevents overflow errors) |
| Phase 3: API exposure | Trivial | None | Medium (operator visibility) |
| 1M beta context | Trivial (1 line) | Medium (Opus support unknown) | Medium (delay, not prevent) |
| Manual windowing | High (8+ hours) | High (SDK format assumptions) | Medium |

### Key risks in the recommended approach

**Risk 1: Token extraction from Captain result messages may differ from regular sessions.**

Regular sessions use `result.usage` (checked in `stream-query.ts:479`). Captain's `processQueryResponse()` accesses the same `message as any` pattern. This should work identically — but it should be validated with a manual test or by temporarily adding debug logging.

**Risk 2: `forkSession` behavior with MCP servers.**

The fleet-control MCP server is a singleton (`getFleetMcpServer()`) and is passed to each query as an in-process server. When `forkSession: true` causes the SDK to create a new session ID, the MCP server connection should be re-established by the SDK automatically. This is the SDK's documented behavior for SDK-side MCP servers. However, if the SDK re-initializes the MCP server during fork, there is a brief window where tool calls will fail. Rotation should only be triggered after a query completes (not mid-query), which Phase 2 enforces via `setImmediate()`.

**Risk 3: Context metric accuracy.**

The `input_tokens` in the result's `usage` field represents tokens consumed in the most recent query turn, not the cumulative session context. To track cumulative context, the `cache_read_input_tokens` (which includes prior context served from cache) plus `input_tokens` (new tokens) gives the best estimate of total context size for that turn. This is what `stream-query.ts:482` already does. The same logic should be applied in Captain.

**Risk 4: Auto-compact may not always trigger.**

If the SDK's auto-compact fails transiently (network error during the compaction API call), the context overflow error will propagate to Captain's catch block. With the current code this leaves Captain in a broken state. A recovery path should be added: if the error message contains "context length exceeded" (or similar), Captain should attempt to start a fresh session (without `resume`) rather than retrying against the overflowed session.

---

## 7. Implementation Checklist

- [ ] Add `lastInputTokens`, `totalInputTokens` to `CaptainState` (captain.ts)
- [ ] Add `CAPTAIN_CONTEXT_WINDOW` and `CAPTAIN_CONTEXT_RESET_THRESHOLD` constants (config.ts)
- [ ] Handle `compact_boundary` messages in `processQueryResponse()` with a log line (captain.ts)
- [ ] Extract token usage from `result` messages in `processQueryResponse()` (captain.ts)
- [ ] Expose `lastInputTokens`, `contextPct` in `getCaptainStatus()` (captain.ts)
- [ ] Add context overflow error detection in catch block (captain.ts)
- [ ] (Optional) Implement `rotateSessionIfNeeded()` with `forkSession: true` (captain.ts)
- [ ] Write unit tests for `processQueryResponse()` token extraction
- [ ] Validate `compact_boundary` handling in integration test or manual test
- [ ] Update `GET /api/captain/status` response documentation if applicable

---

## 8. Files Referenced

| File | Key sections |
|---|---|
| `backend-ts/src/captain.ts` | `processQueryResponse()` L234, `startCaptainQuery()` L416, `CaptainState` L59, query options L165–184, L437–456 |
| `backend-ts/src/captain-prompt.ts` | `CAPTAIN_SYSTEM_PROMPT_TEMPLATE` L53, prompt cache TTL L22 |
| `backend-ts/src/config.ts` | `CAPTAIN_MODEL` L104, `CAPTAIN_MAX_TURNS` L105, `CAPTAIN_RESUME_ON_STARTUP` L109 |
| `backend-ts/src/state-persistence.ts` | `saveCaptainState()` L16, `loadCaptainState()` L25 |
| `backend-ts/src/sdk/stream-query.ts` | Token extraction L476–499, `compact_boundary` handling L589–597 |
| `backend-ts/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` | `SDKCompactBoundaryMessage` L1666, `SDKStatus` L2226, `PostCompactHookInput` L1306, `Options` L744, `betas` L887 |
