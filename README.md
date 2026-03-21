# cc+ — Watch your agents work.

Open-source desktop app for Claude Code. See every tool call, every agent, every token — in real-time. Run multiple sessions. Orchestrate your fleet with Captain. Free, local, yours.

<p align="center">
  <a href="https://github.com/kerplunkstudio/ccplus/actions"><img src="https://img.shields.io/github/actions/workflow/status/kerplunkstudio/ccplus/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="https://github.com/kerplunkstudio/ccplus/releases"><img src="https://img.shields.io/github/v/release/kerplunkstudio/ccplus?include_prereleases&style=for-the-badge" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey?style=for-the-badge"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey?style=for-the-badge" alt="Platform"></a>
</p>

<p align="center"><img src="docs/screenshot.png" alt="cc+ activity tree" width="800"></p>

[Website](https://ccplus.run) · [GitHub](https://github.com/kerplunkstudio/ccplus) · [Install](#install)

---

## Install

```sh
curl -fsSL https://ccplus.run/install | sh
```

Requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). macOS and Linux.

---

## See Everything

Real-time activity trees. Every agent spawn, tool call, and file edit, structured as a hierarchy. Agent → sub-agent → Read → Edit → Write. Status, duration, parameters. Not terminal scroll, a live tree.

Token and cost tracking per query, session, and project. Context window usage. Trust scores. Cache efficiency.

## Run the Fleet

Multi-tab sessions (Cmd+T, Cmd+W, Ctrl+Tab). Each tab is its own Claude Code session. Fleet monitor shows all sessions at once: status, tools, tokens, files touched.

Captain: a persistent AI that manages your sessions. Tell it what you want in plain language. It writes the prompt, picks the workspace, starts the session in an isolated worktree, and watches it. If an agent gets stuck, Captain cancels and retries with a better prompt. When it's done, you get a summary.

## Access Anywhere

Desktop app (Electron, macOS + Linux). Web UI at localhost. Telegram bridge: message Captain from your phone, get status updates, start sessions remotely. Voice messages transcribed with Whisper.

---

## More Features

<details>
<summary><strong>Click to expand</strong></summary>

- Built-in browser (dev servers detected automatically)
- Integrated terminal
- Command palette (Cmd+K)
- Conversation search (FTS5)
- Scheduled tasks (cron-based recurring prompts)
- Cross-session memory
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

## CLI Reference

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

---

## Development

<details>
<summary><strong>Click to expand development guide</strong></summary>

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

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_PATH` | `~/Workspace` | Working directory for SDK sessions |
| `SDK_MODEL` | `sonnet` | Default model for SDK queries |
| `PORT` | `4000` | Server port |

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

## Contributing

Fork, branch, test, PR. See [CLAUDE.md](CLAUDE.md) for conventions.

---

## License

MIT License. Copyright 2025-present Matias Fuentes. See [LICENSE](LICENSE).

---

<p align="center">
  Built with <a href="https://www.anthropic.com/claude">Claude</a> by <a href="https://github.com/kerplunkstudio">@kerplunkstudio</a>
</p>
