<h1 align="center">cc+</h1>
<p align="center"><strong>The Claude Code experience you wish the terminal gave you.</strong></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License: MIT" /></a>
  <a href="https://github.com/Kerplunk-Studio/ccplus/actions"><img src="https://img.shields.io/github/actions/workflow/status/Kerplunk-Studio/ccplus/ci.yml?branch=main&style=for-the-badge" alt="Build Status" /></a>
  <a href="https://github.com/Kerplunk-Studio/ccplus/releases"><img src="https://img.shields.io/github/v/release/Kerplunk-Studio/ccplus?include_prereleases&style=for-the-badge" alt="Release" /></a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#development">Development</a> •
  <a href="CLAUDE.md">Full Docs</a>
</p>

---

## What is cc+?

**cc+** (ccplus) is a web UI and observability layer for Claude Code. It wraps the Claude Code SDK in a browser-based IDE with tabbed sessions, a live activity tree showing every agent spawn and tool call in real-time, usage insights, and proper markdown rendering.

**Core design principle**: No routing layer, no orchestrator, no task queue. User messages go straight to the Claude Code SDK via WebSocket. The SDK does the work. cc+ shows you what it is doing.

## Features

**Live Activity Tree** — Real-time hierarchical visualization of every tool call and subagent spawn. Watch Claude's thought process unfold as nested agent trees with collapsible nodes, status indicators, and duration tracking.

**Tabbed Sessions** — Multiple concurrent conversations with independent history and activity streams. Switch between tasks without losing context.

**Session Insights** — Aggregate statistics across all conversations: tool usage patterns, success rates, cost breakdowns, and performance metrics. Export to CSV for deeper analysis.

**Desktop App** — Native Electron wrapper for macOS, Linux, and Windows. No browser required. Runs the full backend stack in-process with window state persistence.

**Workspace Browser** — Navigate your codebase directly from the UI. View file trees, open files, and see what Claude is working on without switching windows.

**Interactive Onboarding** — First-run wizard configures workspace paths, model selection, and environment variables. Zero-config for subsequent launches.

**Markdown Rendering** — Full GitHub-flavored markdown with syntax highlighting for code blocks, tables, task lists, and inline LaTeX. Makes Claude's responses readable.

**One-Line Install** — `curl -fsSL https://raw.githubusercontent.com/Kerplunk-Studio/ccplus/main/install.sh | bash` or clone and `./ccplus`. Automatic dependency checks, interactive setup, and immediate launch.

## Getting Started

### Requirements

- **Node.js 18+** — Backend runtime and build toolchain
- **Claude Code CLI** — Must be installed and authenticated ([installation guide](https://github.com/anthropics/claude-code))

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/Kerplunk-Studio/ccplus/main/install.sh | bash
cd ccplus
./ccplus
```

First run will:
1. Check prerequisites (Node 18+, Claude CLI)
2. Install backend and frontend dependencies
3. Interactively configure `.env` (workspace path, model, etc.)
4. Build TypeScript backend and React frontend
5. Launch the desktop app

### Manual Install

```bash
git clone https://github.com/Kerplunk-Studio/ccplus.git
cd ccplus

# Backend (TypeScript)
cd backend-ts && npm install && npm run build && cd ..

# Frontend (React 19)
cd frontend && npm install && cd ..

# Environment
cp .env.example .env
# Edit .env with your values (WORKSPACE_PATH, SDK_MODEL, etc.)

# Launch
./ccplus
```

### Run Modes

**Desktop app** (default):
```bash
./ccplus              # Exclusive mode (stops web server)
./ccplus desktop      # Same as above
```

**Desktop app (parallel)** — recommended for development:
```bash
./ccplus desktop-parallel    # Runs alongside web server on port 4001
```

**Web UI**:
```bash
./ccplus web          # Access at http://localhost:4000
```

**Health check**:
```bash
./ccplus doctor       # System diagnostics (Node version, services, DB status)
```

## Architecture

### Stack

- **Backend**: Node.js / TypeScript / Express + Socket.IO
- **Frontend**: React 19 / TypeScript / Socket.IO client
- **SDK**: Claude Agent SDK (async generators, in-process streaming)
- **Database**: SQLite (better-sqlite3, WAL mode)
- **Desktop**: Electron (macOS, Linux, Windows)

### Message Flow

```
Browser (React)
    |
    | socket.emit("message", { message: "..." })
    v
Socket.IO (server.ts)
    |
    | 1. Record user message to SQLite
    | 2. Emit "message_received" ack
    | 3. Call sdkSession.submitQuery()
    v
Session Manager (sdk-session.ts)
    |
    | Calls query() from @anthropic-ai/claude-agent-sdk
    | Streaming runs in-process (async generator)
    v
Claude Agent SDK
    |
    | async for message in query(prompt, options):
    |   - message.type == "assistant" -> text blocks + tool_use blocks
    |   - message.type == "result"    -> session metadata, cost, tokens
    v
Callbacks (defined in server.ts buildSocketCallbacks)
    |
    | onText(chunk)       -> io.to(sessionId).emit("text_delta", ...)
    | onToolEvent(event) -> io.to(sessionId).emit("tool_event", ...)
    |                       + recordToolEvent() to SQLite
    | onComplete(result)  -> recordMessage() to SQLite
    |                       + io.to(sessionId).emit("response_complete", ...)
    | onError(msg)        -> io.to(sessionId).emit("error", ...)
    v
Browser receives events, updates UI
```

### Core Components

| File | Purpose |
|------|---------|
| `backend-ts/src/server.ts` | Express + Socket.IO server, HTTP routes, WebSocket handlers |
| `backend-ts/src/sdk-session.ts` | SDK session lifecycle, streaming callbacks, hooks |
| `backend-ts/src/database.ts` | SQLite operations (better-sqlite3, synchronous, singleton) |
| `frontend/src/hooks/useSocket.ts` | WebSocket client, message state, activity tree reducer |
| `frontend/src/components/ActivityTree.tsx` | Real-time agent/tool tree with collapsible nodes |

### Activity Tree Construction

The frontend builds a tree from flat `tool_event` WebSocket events using an immutable reducer.

**How it works**:
- Each tool/agent invocation emits `tool_start` / `agent_start` events with `tool_use_id` and optional `parent_agent_id`
- The reducer recursively inserts nodes under their parent or appends to root if no parent
- `tool_complete` / `agent_stop` events update node status, duration, and error state
- Tree resets on each new user message

**Node types**:
- `AgentNode`: Has `children[]`, `agent_type`, `description`. Collapsible in UI.
- `ToolNode`: Leaf node with `tool_name`, `parameters`. Not collapsible.

Both have `status: 'running' | 'completed' | 'failed'` and optional `duration_ms`, `error`.

### Async Model

- **Node.js event loop**: Single-threaded async with non-blocking I/O
- **SDK queries**: Run as async generators in the same event loop (in-process, no workers)
- **better-sqlite3**: Synchronous database operations, singleton connection, WAL mode for concurrent reads
- **No threading**: All operations execute sequentially in the event loop, async/await for I/O

Server restart interrupts active SDK sessions since they run in-process. Clients automatically reconnect via Socket.IO.

## Development

### Backend Development

```bash
cd backend-ts

# Install dependencies
npm install

# Development (watch mode, auto-reload)
npm run dev

# Build (compile TypeScript to dist/)
npm run build

# Test (Vitest)
npm test

# Coverage
npm run test:coverage
```

**Test suite**: 149 tests across 5 files (config, auth, database, sdk-session, server). Coverage targets: 80%+ on critical paths (sdk-session, database), 100% on utilities (auth, config).

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Development server (port 3001, proxies API to 3000)
npm start

# Production build
npm run build

# Test (Jest + React Testing Library)
npm test
```

After modifying frontend source, deploy the build:
```bash
./ccplus frontend    # Build + deploy to static/chat/ (no restart)
```

Then hard refresh browser (Cmd+Shift+R) to clear cached assets.

**Important**: Express serves from `static/chat/`, not `frontend/src/`. If you edit source files but do not deploy, the browser shows stale code.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_PATH` | `~/Workspace` | Working directory for SDK sessions |
| `SDK_MODEL` | `sonnet` | Default model for SDK queries |
| `PORT` | `4000` | Server port |
| `CCPLUS_AUTH` | `local` | Auth mode (`local` for auto-login) |
| `SECRET_KEY` | `ccplus-dev-secret-change-me` | JWT signing key (change in production) |

### File Organization

```
ccplus/
├── backend-ts/
│   ├── src/
│   │   ├── server.ts          # Express + Socket.IO (entry point)
│   │   ├── sdk-session.ts     # SDK session lifecycle + hooks
│   │   ├── database.ts        # SQLite operations (better-sqlite3)
│   │   ├── auth.ts            # JWT auth (jsonwebtoken)
│   │   ├── config.ts          # Environment config
│   │   └── __tests__/         # Vitest tests (149 tests)
│   ├── dist/                  # Compiled JS (gitignored)
│   └── tsconfig.json
├── electron/
│   ├── main.js                # Electron main process
│   ├── preload.js             # IPC bridge
│   └── assets/                # App icons (icns, png, ico)
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/        # ChatPanel, ActivityTree, MessageBubble
│   │   ├── hooks/             # useSocket, useAuth
│   │   └── types/             # TypeScript interfaces
│   └── build/                 # Generated (gitignored)
├── static/chat/               # Deployed build (gitignored)
├── data/                      # SQLite DB (gitignored)
├── ccplus                     # Unified launcher and deployment tool
└── .env                       # Environment config (gitignored)
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `./ccplus` or `./ccplus start` | Full deploy: build backend + frontend, launch desktop app. First run = interactive setup. |
| `./ccplus web` | Full deploy: build backend + frontend, start web server. |
| `./ccplus desktop` | Launch Electron desktop app (stops web server). Same as `./ccplus`. |
| `./ccplus desktop-parallel` | Launch Electron app alongside web server (port 4001). **Recommended for development.** |
| `./ccplus server` | Restart Node.js server (interrupts active SDK sessions). |
| `./ccplus backend` | Build TypeScript backend only (compile to `dist/`). |
| `./ccplus frontend` | Build + deploy frontend only (no restart). |
| `./ccplus stop` | Stop Node.js server. |
| `./ccplus doctor` | Run system diagnostics (Node version, services, build status, DB). |
| `./ccplus setup` | Force re-run interactive setup (reinstall deps, configure `.env`). |
| `./ccplus release` | Build and package desktop app for distribution. |
| `./ccplus check-update` | Check for available updates. |
| `./ccplus update` | Update to latest version from GitHub. |
| `./ccplus status` | Show server status and active sessions. |
| `./ccplus logs` | Tail server logs (`logs/server.log`). |

## Testing

### Backend Tests

**Run all tests**:
```bash
cd backend-ts && npm test
```

**Run specific module**:
```bash
cd backend-ts && npx vitest run src/__tests__/database.test.ts
```

**Coverage**:
```bash
cd backend-ts && npm run test:coverage
```

**Test files** (149 tests total):
- `config.test.ts` (6 tests) — Environment variable loading, defaults, directory creation
- `auth.test.ts` (12 tests) — JWT generation, verification, expiry, local mode
- `database.test.ts` (58 tests) — CRUD operations, conversation history, tool events, stats, images
- `sdk-session.test.ts` (29 tests) — Session lifecycle, cancellation, callback dispatch, hooks
- `server.test.ts` (44 tests) — HTTP routes, WebSocket events, auth flow, health check

### Frontend Tests

**Run all tests**:
```bash
cd frontend && npm test
```

**Test files**:
- `ChatPanel.test.tsx` — Chat interface, streaming, auto-resize textarea, send/cancel
- `ActivityTree.test.tsx` — Tree rendering, collapsible nodes, status icons
- `MessageBubble.test.tsx` — Markdown rendering, code highlighting

### Test Policy

Tests are mandatory for all implementations:
- **New features**: Unit tests for logic + integration tests for flows
- **Bug fixes**: Regression test that fails without the fix, passes with it
- **Refactoring**: Existing tests pass before and after changes

Coverage targets: 80%+ on critical paths (sdk-session, database), 100% on utility functions (auth, config).

## Database Schema

**Location**: `data/ccplus.db` (SQLite, WAL mode)

### Tables

**conversations**:
```sql
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,       -- Browser session ID
    user_id TEXT NOT NULL,          -- "local" in local mode
    role TEXT NOT NULL,             -- "user" or "assistant"
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    sdk_session_id TEXT             -- SDK session UUID
);
```

**tool_usage**:
```sql
CREATE TABLE tool_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,        -- "Bash", "Read", "Edit", "Agent", etc.
    duration_ms REAL,
    success BOOLEAN,
    error TEXT,
    error_category TEXT,
    parameters TEXT,                -- JSON blob (truncated to 200 chars per value)
    tool_use_id TEXT,               -- Unique ID for this tool invocation
    parent_agent_id TEXT,           -- tool_use_id of parent Agent (null at root)
    agent_type TEXT,                -- For Agent/Task tools
    input_tokens INTEGER,
    output_tokens INTEGER
);
```

### Common Queries

**Recent conversations**:
```bash
sqlite3 data/ccplus.db "SELECT session_id, role, substr(content, 1, 80), timestamp FROM conversations ORDER BY timestamp DESC LIMIT 20;"
```

**Tool usage summary**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, COUNT(*) as count, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures FROM tool_usage GROUP BY tool_name ORDER BY count DESC;"
```

**Agent hierarchy for a session**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, tool_use_id, parent_agent_id, agent_type, success, duration_ms FROM tool_usage WHERE session_id = 'SESSION_ID' ORDER BY timestamp;"
```

**Errors**:
```bash
sqlite3 data/ccplus.db "SELECT tool_name, error, timestamp FROM tool_usage WHERE error IS NOT NULL ORDER BY timestamp DESC LIMIT 20;"
```

## WebSocket Protocol

### Connection

WebSocket connects to the Socket.IO server with auth:
```typescript
io(SOCKET_URL, {
    auth: { token, session_id },
    transports: ['polling', 'websocket'],
});
```

Server validates JWT on `connect` event. Invalid token causes `disconnect()`.

### Client to Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `{ message: string }` | Send user message to Claude Code SDK |
| `cancel` | (none) | Cancel the active SDK query for this session |
| `ping` | (none) | Keepalive ping |

### Server to Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{ session_id }` | Connection confirmed, session joined |
| `message_received` | `{ status: "ok" }` | User message acknowledged |
| `text_delta` | `{ text: string }` | Streaming text chunk from Claude |
| `tool_event` | `ToolEvent` | Tool/agent lifecycle event (see below) |
| `response_complete` | `{ cost, duration_ms, input_tokens, output_tokens }` | SDK query finished |
| `error` | `{ message: string }` | Error during SDK query |
| `cancelled` | `{ status: "ok" }` | Cancellation confirmed |
| `pong` | `{ timestamp: number }` | Keepalive response |

### Tool Event Types

All delivered via the `tool_event` WebSocket event:

**tool_start** — Tool invocation began:
```json
{
    "type": "tool_start",
    "tool_name": "Bash",
    "tool_use_id": "toolu_abc123",
    "parent_agent_id": "toolu_parent456",
    "parameters": { "command": "pytest tests/" },
    "timestamp": "2025-01-15T10:30:00",
    "session_id": "session_xxx"
}
```

**tool_complete** — Tool invocation finished:
```json
{
    "type": "tool_complete",
    "tool_name": "Bash",
    "tool_use_id": "toolu_abc123",
    "success": true,
    "error": null,
    "duration_ms": 1234.5
}
```

**agent_start** — Subagent spawned:
```json
{
    "type": "agent_start",
    "tool_name": "Agent",
    "tool_use_id": "toolu_agent789",
    "agent_type": "code_agent",
    "description": "Implement the auth module"
}
```

**agent_stop** — Subagent completed:
```json
{
    "type": "agent_stop",
    "tool_use_id": "toolu_agent789",
    "success": true,
    "duration_ms": 45000
}
```

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve React SPA |
| GET | `/<path>` | Serve static assets |
| GET | `/health` | Health check (uptime, sessions, clients, DB stats) |
| POST | `/api/auth/auto-login` | Generate JWT for local user (local mode only) |
| POST | `/api/auth/verify` | Verify JWT, return user info |
| GET | `/api/history/<session_id>` | Conversation history for a session |
| GET | `/api/stats` | Aggregate tool usage and conversation statistics |

## Contributing

We welcome contributions. Please follow these guidelines:

1. **Fork** the repository
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Write tests** for new features (backend: Vitest, frontend: Jest + React Testing Library)
4. **Ensure tests pass** (`cd backend-ts && npm test` and `cd frontend && npm test`)
5. **Commit your changes** (`git commit -m 'Add amazing feature'`)
6. **Push to the branch** (`git push origin feature/amazing-feature`)
7. **Open a Pull Request**

**Test requirements**:
- Backend changes require backend tests (`backend-ts/src/__tests__/`)
- Frontend changes require component tests (`frontend/src/components/*.test.tsx`)
- All tests must pass before PR merge

**Code style**:
- Backend: TypeScript strict mode, ESM modules, `kebab-case.ts` for files
- Frontend: TypeScript strict mode, functional components only, `PascalCase.tsx` for components
- Line length: 120 characters
- No mutations: All state updates create new objects

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with <a href="https://www.anthropic.com/claude">Claude</a> by <a href="https://github.com/mjfuentes">@mjfuentes</a>
</p>
