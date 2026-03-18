# cc+

Claude Code with eyes.

## Install

```sh
curl -fsSL https://ccplus.run/install | sh
```

Requires a [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) subscription.

---

**cc+** gives Claude Code a real-time activity tree, tabbed sessions, usage insights, and proper markdown rendering. No orchestrator, no routing layer — user messages go straight to the Claude Code SDK via WebSocket.

## Features

- **Live Activity Tree** — Real-time nested visualization of every tool call and agent spawn
- **Tabbed Sessions** — Multiple concurrent conversations with independent context
- **Usage Insights** — Aggregate statistics across conversations (tool patterns, costs, performance)
- **Desktop App** — Native wrapper for macOS, Linux, Windows (Electron)
- **Workspace Browser** — Navigate your codebase directly from the UI
- **Markdown Rendering** — GitHub-flavored markdown with syntax highlighting and LaTeX

## Architecture

**Stack**: Node.js / TypeScript / Express + Socket.IO / React 19 / SQLite / Electron

**Message flow**: User messages → WebSocket → Claude Agent SDK (in-process streaming) → Real-time callbacks → SQLite + activity tree updates

See [CLAUDE.md](CLAUDE.md) for full architecture details.

---

<details>
<summary><strong>Development</strong></summary>

## Development Setup

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
| `./ccplus desktop` | Launch Electron desktop app directly (skips build/deploy). |
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

</details>

---

## Contributing

Fork, branch, test, PR. See [CLAUDE.md](CLAUDE.md) for code style and architecture details.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with <a href="https://www.anthropic.com/claude">Claude</a> by <a href="https://github.com/mjfuentes">@mjfuentes</a>
</p>
