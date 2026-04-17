# Component Locations

Quick reference for finding components in the cc+ codebase.

## Backend

| File | Purpose |
|------|---------|
| `backend-ts/src/server.ts` | Express + Socket.IO server, HTTP routes, WebSocket event handlers |
| `backend-ts/src/sdk-session.ts` | SDK session manager, in-process streaming, hooks |
| `backend-ts/src/database.ts` | SQLite operations via better-sqlite3 (synchronous, singleton) |
| `backend-ts/src/config.ts` | Environment config, paths, constants |
| `backend-ts/src/doctor.ts` | System diagnostics (./ccplus doctor) |
| `backend-ts/src/logger.ts` | Application logging |
| `backend-ts/src/mcp-config.ts` | MCP server configuration |
| `backend-ts/src/scheduler.ts` | Task scheduling |
| `backend-ts/src/utils.ts` | Shared utility functions |
| `backend-ts/src/captain.ts` | Captain orchestrator: persistent SDK session that drives the fleet |
| `backend-ts/src/captain-tools.ts` | MCP tool definitions for fleet control (start/stop/list sessions, etc.) |
| `backend-ts/src/captain-router.ts` | Routes incoming messages (web, Telegram, fleet events) to Captain |
| `backend-ts/src/captain-tick.ts` | Periodic tick: polls projects, triggers KAIROS, monitors sessions |
| `backend-ts/src/captain-prompt.ts` | Captain system prompt construction |
| `backend-ts/src/captain-memory.ts` | Memory read/write wrappers for Captain |
| `backend-ts/src/captain-auth.ts` | Auth/access control for Captain API |
| `backend-ts/src/fleet-monitor.ts` | Fleet session registry: status, trust scores, Socket.IO broadcast |
| `backend-ts/src/git-operations.ts` | Git worktree creation and cleanup for isolated fleet sessions |
| `backend-ts/src/trust-score.ts` | Per-session trust scoring (success rate, error patterns) |
| `backend-ts/src/circuit-breaker.ts` | Circuit breaker for external service calls |
| `backend-ts/src/kairos-daemon.ts` | KAIROS tick trigger: batches unanalyzed sessions, notifies Captain |
| `backend-ts/src/kairos-runner.ts` | Runs KAIROS analysis session and applies patch results |
| `backend-ts/src/kairos-prompt.ts` | KAIROS system prompt construction |
| `backend-ts/src/kairos-prompt-patcher.ts` | Applies prompt improvements produced by KAIROS runs |
| `backend-ts/src/memory-client.ts` | Lightweight MCP client for the memory server (stdio JSON-RPC) |
| `backend-ts/src/memory-distiller.ts` | Distills session content into memory entries |
| `backend-ts/src/memory-gc.ts` | Memory garbage collection and deduplication |
| `backend-ts/src/memory-promotion.ts` | Promotes high-value memories to long-term tier |
| `backend-ts/src/telegram-bridge.ts` | Telegram bot: forwards messages to Captain, sends replies |
| `backend-ts/src/telegram-format.ts` | Formats Captain responses for Telegram MarkdownV2 |
| `backend-ts/src/voice-transcriber.ts` | Transcribes voice messages via whisper-cli |
| `backend-ts/src/pty-service.ts` | PTY (pseudo-terminal) service for interactive shell sessions |
| `backend-ts/src/routes/` | Domain-split HTTP route handlers (sessions, projects, memory, etc.) |
| `backend-ts/src/db/` | Domain-split SQLite modules (sessions, fleet, kairos, memory, etc.) |
| `backend-ts/src/sdk/hooks.ts` | SDK hook implementations (tool events, cost tracking) |

## Frontend

| File | Purpose |
|------|---------|
| `frontend/src/App.tsx` | Root component, workspace management, tab system, panel routing |
| `frontend/src/types/index.ts` | TypeScript interfaces -- Message, ToolEvent, ActivityNode, AgentNode, ToolNode |
| `frontend/src/hooks/useSocketConnection.ts` | WebSocket connection lifecycle |
| `frontend/src/hooks/useActivityTree.ts` | Activity tree reducer and state management |
| `frontend/src/hooks/useStreamingMessages.ts` | Streaming message handling and token counting |
| `frontend/src/hooks/useSessionActions.ts` | Session actions (send, cancel, answer) |
| `frontend/src/hooks/useSessionRestore.ts` | Session state restoration from database |
| `frontend/src/hooks/useToolEvents.ts` | Tool event processing and tree updates |
| `frontend/src/hooks/useTabSocket.ts` | Tab-specific socket orchestration (combines all hooks) |
| `frontend/src/hooks/usePlugins.ts` | Plugin management (install, uninstall, list) |
| `frontend/src/hooks/useSkills.ts` | Skills API and slash command integration |
| `frontend/src/hooks/useWorkspace.ts` | Workspace/project/tab state management |
| `frontend/src/hooks/useScheduler.ts` | Scheduled task management |
| `frontend/src/components/ChatPanel.tsx` | Chat interface with streaming, auto-resize textarea, send/cancel |
| `frontend/src/components/ActivityTree.tsx` | Real-time agent/tool tree with collapsible nodes, status icons |
| `frontend/src/components/MessageBubble.tsx` | Markdown rendering for individual messages |

## Desktop App

| File | Purpose |
|------|---------|
| `electron/main.js` | Electron main process -- app lifecycle, launches Node.js server, creates window |
| `electron/preload.js` | IPC bridge with secure context isolation |
| `electron/assets/` | App icons for macOS (.icns), Linux (.png), Windows (.ico) |
| `package.json` | Electron dependencies and build configuration |

## Other

| Path | Purpose |
|------|---------|
| `static/chat/` | Built frontend served by Express (generated by ./ccplus) |
| `data/ccplus.db` | SQLite database (runtime, gitignored) |
| `logs/server.log` | Application log (runtime, gitignored) |
| `backend-ts/src/__tests__/` | Vitest test suite for backend |
| `ccplus` | Unified launcher and deployment tool |
| `ccplus-desktop` | Desktop app launcher (delegates to ./ccplus desktop) |

## Configuration Constants (config.ts)

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_CONVERSATION_HISTORY` | 50 | Max messages returned per session |
| `MAX_ACTIVITY_EVENTS` | 200 | Max tool events returned per session |
| `DATABASE_PATH` | `data/ccplus.db` | SQLite database location |
| `STATIC_DIR` | `static/chat/` | Served frontend build |
