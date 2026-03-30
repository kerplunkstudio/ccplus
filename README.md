# cc+ — Watch your agents work.

Fleet orchestration for Claude Code — run parallel AI coding sessions with real-time observability and multi-agent workflows.

<p align="center">
  <a href="https://github.com/kerplunkstudio/ccplus/actions"><img src="https://img.shields.io/github/actions/workflow/status/kerplunkstudio/ccplus/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="https://github.com/kerplunkstudio/ccplus/releases"><img src="https://img.shields.io/github/v/release/kerplunkstudio/ccplus?include_prereleases&style=for-the-badge" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey?style=for-the-badge"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey?style=for-the-badge" alt="Platform"></a>
</p>

<p align="center"><img src="docs/demo.gif" alt="cc+ demo" width="800"></p>

[Website](https://ccplus.run) · [GitHub](https://github.com/kerplunkstudio/ccplus) · [Install](#install)

---

## Who is this for

You're a developer who uses Claude Code daily. You want to run 5 sessions in parallel, each on a different feature, with automated testing and code review. cc+ does that. See every tool call, every agent, every token — in real-time. Fleet monitor shows all sessions at once. Captain orchestrates workflows autonomously.

---

## Quick Install

```sh
curl -fsSL https://ccplus.run/install | sh
```

Requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). macOS and Linux.

### Install from Source

#### Prerequisites

- **Node.js 16+** (check: `node --version`)
- **Claude Code CLI** installed globally: `npm install -g @anthropic-ai/claude-code`
- **Claude authentication**: Run `claude login` and follow prompts
- **Git** (for cloning the repository)

#### Install Steps

1. **Clone the repository**:
   ```sh
   git clone https://github.com/kerplunkstudio/ccplus.git
   cd ccplus
   ```

2. **Install dependencies**:
   ```sh
   cd backend-ts && npm install && cd ..
   cd frontend && npm install && cd ..
   ```

3. **Configure environment** (optional):
   ```sh
   cp .env.example .env
   # Edit .env to customize workspace path, port, etc.
   ```

4. **Build and launch**:
   ```sh
   ./ccplus
   ```

   The first run will:
   - Build backend TypeScript → `backend-ts/dist/`
   - Build frontend React app → `static/chat/`
   - Launch desktop app (Electron)

---

## How It Works

You tell Captain: "fix the auth bug". Captain starts a bug-fix workflow → Debugger investigates → Code Agent patches → TDD Guide writes regression test → Code Reviewer approves → merged to main. You get a summary.

The process is automatic. No manual intervention needed. Captain manages workflow state, retries on failure, and adapts to blockers.

---

## The Model

You talk to Captain. Captain runs workflows. You watch.

Each session is fully isolated. Multi-tab interface. Desktop app (Electron) for macOS/Linux, web UI at localhost for remote access. Real-time activity trees show every agent spawn, tool call, and file edit as a hierarchy.

Token and cost tracking per query, session, and project. Context window usage. Trust scores. Cache efficiency.

---

## Fleet Monitor

Multi-tab sessions (Cmd+T, Cmd+W, Ctrl+Tab). Each tab is its own Claude Code session. Fleet monitor shows all sessions at once: status, tools, tokens, files touched.

---

## See Everything

Real-time activity trees. Every agent spawn, tool call, and file edit, structured as a hierarchy. Agent → sub-agent → Read → Edit → Write. Status, duration, parameters. Not terminal scroll, a live tree.

---

## Cross-Session Memory

Persistent knowledge across sessions.

---

## Scheduled Tasks

Cron-based recurring prompts.

---

---

## Access Anywhere

Desktop app (Electron, macOS + Linux). Web UI at localhost. Telegram bridge: message Captain from your phone, get status updates, start sessions remotely. For Telegram setup details, see [docs](docs/).

---

## Built on the Agent SDK

The Claude Agent SDK does the heavy lifting. cc+ is a real-time observability layer around it.

The SDK handles:
- In-process agent spawning and async streaming
- Tool execution and result injection
- Agent parent-child correlation
- Cooperative cancellation
- File system access (read, edit, write)

cc+ adds:
- Multi-session coordination
- SQLite persistence (conversations, activity tree, costs)
- Real-time WebSocket updates to the UI
- Desktop app + web interface
- Captain AI orchestration
- Telegram bridge

The result: you get full transparency into what your agents are doing, and the power to run them at scale.

---

## More Features

<details>
<summary><strong>Click to expand</strong></summary>

- Built-in browser (dev servers detected automatically)
- Integrated terminal
- Command palette (Cmd+K)
- Conversation search (FTS5)
- Session import from Claude Code history
- Insights dashboard (daily trends, model breakdowns, tool success rates)
- Image attachments
- Themes
- Crash recovery

</details>

---

## Architecture

User messages → WebSocket → Claude Agent SDK → Real-time callbacks → SQLite + activity tree.

**Stack**: Node.js / TypeScript / Express + Socket.IO / React 19 / SQLite / Electron

---

## Development

<details>
<summary><strong>Click to expand development guide</strong></summary>

### CLI Reference

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
| `./ccplus import` | Import historical Claude Code sessions |
| `./ccplus doctor` | System diagnostics |
| `./ccplus setup` | Re-run interactive setup |
| `./ccplus status` | Show server status |
| `./ccplus logs` | Tail server logs |
| `./ccplus update` | Update to latest version |
| `./ccplus release` | Package desktop app for distribution |

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

See [.env.example](.env.example) for all available environment variables. Key settings:

- `WORKSPACE_PATH` — Working directory for SDK sessions (default: `~/Workspace`)
- `SDK_MODEL` — Default model for SDK queries (default: `sonnet`)
- `PORT` — Server port (default: `4000`)
- `CCPLUS_TELEGRAM_BOT_TOKEN` — Enable Telegram bridge (optional)
- `CCPLUS_CAPTAIN_MODEL` — Captain AI model (default: `claude-opus-4-6`)

### File Tree

```
ccplus/
├── backend-ts/          # Express + Socket.IO server
│   ├── src/             # TypeScript source
│   └── dist/            # Compiled output (gitignored)
├── electron/            # Desktop app (Electron)
├── frontend/            # React 19 app
│   ├── src/components/  # React components
│   ├── src/hooks/       # Custom hooks
│   └── build/           # Build output (gitignored)
├── static/chat/         # Deployed frontend (gitignored)
├── data/                # SQLite database (gitignored)
├── docs/                # Architecture, database, development, testing
└── ccplus               # Unified CLI launcher
```

### Testing

#### Backend Tests

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

#### Frontend Tests

**Run all tests**:
```bash
cd frontend && npm test
```

#### Test Policy

Tests are mandatory for all implementations:
- **New features**: Unit tests for logic + integration tests for flows
- **Bug fixes**: Regression test that fails without the fix, passes with it
- **Refactoring**: Existing tests pass before and after changes

Coverage targets: 80%+ on critical paths (sdk-session, database), 100% on utility functions (auth, config).

</details>

---


## Open source, local, yours

MIT licensed. Runs on your machine. Your data stays local.

---
## Contributing

Fork, branch, test, PR. See [CLAUDE.md](CLAUDE.md) for conventions.

---

## License

MIT License. Copyright 2025-present Matias Fuentes. See [LICENSE](LICENSE).

---

<p align="center">
  Built with <a href="https://www.anthropic.com/claude">Claude</a> by <a href="https://github.com/kerplunkstudio">@kerplunkstudio</a>
</p>
