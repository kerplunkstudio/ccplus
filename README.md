<div align="center">

# cc+

**A desktop app for Claude Code with multi-tab sessions, agent observability, and a built-in browser.**

<img src="docs/demo.gif" alt="cc+ demo" width="800">

```sh
curl -fsSL https://ccplus.run/install | sh
```

Requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) subscription.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey.svg)]()

</div>

---

## What is cc+?

cc+ wraps the Claude Agent SDK in a desktop app with full observability. Watch agents work in real time, manage multiple sessions in browser-style tabs, and get instant visual feedback without touching a single file.

## Install

```sh
curl -fsSL https://ccplus.run/install | sh
```

Requires a [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) subscription. macOS and Linux only.

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Tab Sessions** | Browser-style tabs (Cmd+T, Cmd+W, Ctrl+Tab). Each tab is independent. |
| **Agent Observability** | Real-time activity trees showing every tool call, agent spawn, and decision. |
| **Built-in Browser** | Browser tabs alongside chat. Dev server auto-detection. VerifyApp screenshots. |
| **Command Palette** | Cmd+K for fuzzy search across sessions, projects, and actions. |
| **Conversation Search** | Full-text search across all message history (SQLite FTS5). |
| **Scheduled Tasks** | Recurring prompts on intervals. `/loop 5m check the deploy`. |
| **Usage Insights** | Cost trends, tool success rates, token usage, per-project breakdowns. CSV export. |
| **Model Selection** | Switch between Claude models on the fly. |
| **Image Attachments** | Drag and drop images into chat. |
| **Path Autocomplete** | Intelligent file path completion in the input. |
| **Session Management** | Duplicate, archive, restore sessions. Persistent history across refreshes. |

## Architecture

User messages → WebSocket → Claude Agent SDK (in-process streaming) → Real-time callbacks → SQLite + activity tree updates.

**Stack**: Node.js / TypeScript / Express + Socket.IO / React 19 / SQLite / Electron

See [CLAUDE.md](CLAUDE.md) for full architecture details.

## Stats

- 1,575 tests (456 backend Vitest + 1,119 frontend Jest)
- 47 React components, 26 custom hooks
- 11 SQLite tables with FTS
- CI on every PR (GitHub Actions)

<details>
<summary><strong>CLI Reference</strong></summary>

| Command | Description |
|---------|-------------|
| `./ccplus` | Build everything + launch desktop app |
| `./ccplus web` | Build everything + start web server |
| `./ccplus desktop` | Launch desktop app (skip build) |
| `./ccplus desktop-parallel` | Desktop + web server on port 4001 |
| `./ccplus frontend` | Build + deploy frontend only |
| `./ccplus backend` | Build backend only |
| `./ccplus server` | Restart server |
| `./ccplus stop` | Stop server |
| `./ccplus doctor` | System diagnostics |
| `./ccplus setup` | Re-run interactive setup |
| `./ccplus status` | Show server status |
| `./ccplus logs` | Tail server logs |
| `./ccplus update` | Update to latest version |
| `./ccplus release` | Package desktop app for distribution |

</details>

<details>
<summary><strong>Development</strong></summary>

## Backend Development

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

## Frontend Development

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_PATH` | `~/Workspace` | Working directory for SDK sessions |
| `SDK_MODEL` | `sonnet` | Default model for SDK queries |
| `PORT` | `4000` | Server port |

## File Tree

```
ccplus/
├── backend-ts/          # Express + Socket.IO server
│   ├── src/             # TypeScript source
│   └── dist/            # Compiled output (gitignored)
├── electron/            # Desktop app (Electron)
├── frontend/            # React 19 app
│   ├── src/components/  # 47 components
│   ├── src/hooks/       # 26 custom hooks
│   └── build/           # Build output (gitignored)
├── static/chat/         # Deployed frontend (gitignored)
├── data/                # SQLite database (gitignored)
├── docs/                # Architecture, database, development, testing
└── ccplus               # Unified CLI launcher
```

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

**Test suite**: 456 tests across core modules (config, auth, database, sdk-session, server) and features (search, logger, mcp-api, mcp-config).

### Frontend Tests

**Run all tests**:
```bash
cd frontend && npm test
```

**Test suite**: 1,119 tests covering components, hooks, and utilities.

### Test Policy

Tests are mandatory for all implementations:
- **New features**: Unit tests for logic + integration tests for flows
- **Bug fixes**: Regression test that fails without the fix, passes with it
- **Refactoring**: Existing tests pass before and after changes

Coverage targets: 80%+ on critical paths (sdk-session, database), 100% on utility functions (auth, config).

</details>

## Contributing

Fork, branch, test, PR. See [CLAUDE.md](CLAUDE.md) for code style and architecture details.

## License

MIT License. Copyright 2025-present Matias Fuentes. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with <a href="https://www.anthropic.com/claude">Claude</a> by <a href="https://github.com/kerplunkstudio">@kerplunkstudio</a>
</p>
