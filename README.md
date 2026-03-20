# cc+ — Desktop App for Claude Code

<p align="center">
  <img src="docs/demo.gif" alt="cc+ demo" width="800">
</p>

<p align="center">
  <a href="https://github.com/kerplunkstudio/ccplus/actions"><img src="https://img.shields.io/github/actions/workflow/status/kerplunkstudio/ccplus/ci.yml?branch=main&style=for-the-badge" alt="CI"></a>
  <a href="https://github.com/kerplunkstudio/ccplus/releases"><img src="https://img.shields.io/github/v/release/kerplunkstudio/ccplus?include_prereleases&style=for-the-badge" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey?style=for-the-badge"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey?style=for-the-badge" alt="Platform"></a>
</p>

cc+ wraps the Claude Agent SDK in a desktop app with full observability. Multi-tab sessions, real-time activity trees, usage analytics, and a built-in browser — all in one window. Free, open source, local.

[Website](https://ccplus.run) · [GitHub](https://github.com/kerplunkstudio/ccplus) · [Install](#install) · [Highlights](#highlights) · [CLI Reference](#cli-reference) · [Development](#development) · [Contributing](#contributing)

## Install

```sh
curl -fsSL https://ccplus.run/install | sh
```

Requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). macOS and Linux.

## Highlights

- **Multi-Tab Sessions** — Browser-style tabs. Cmd+T, Cmd+W, Ctrl+Tab. Each tab is its own session.
- **Agent Observability** — Real-time activity trees. Every tool call, agent spawn, and decision.
- **Built-in Browser** — Open localhost next to chat. Dev servers detected automatically.
- **Integrated Terminal** — Floating terminal inside the app. Drag, resize, minimize.
- **Command Palette** — Cmd+K. Find any session, project, or action.
- **Usage Insights** — Cost tracking, model breakdowns, cache efficiency, tool success rates. Import historical sessions. CSV export.
- **Conversation Search** — Full-text search across all messages (FTS5).
- **Scheduled Tasks** — Recurring prompts on intervals. `/loop 5m check the deploy`.
- **Cross-Session Memory** — Agents remember what they learned. Knowledge carries between sessions.
- **Workflow Enforcement** — Agents plan before they act. State machine keeps them honest.
- **Themes** — Six color presets. Switch from the profile.
- **Session Import** — Pull in historical Claude Code sessions from `~/.claude/projects/`.
- **Model Selection** — Switch Claude models per session.
- **Image Attachments** — Drag and drop images into chat.
- **Path Autocomplete** — File path completion in the input box.
- **Plugin System** — Install, manage, and build plugins. MCP server support.
- **Crash Recovery** — Auto-recovers from renderer crashes. No lost work.

## Stats

- 1,644 tests (524 backend Vitest + 1,120 frontend Jest)
- 75 React components, 25 custom hooks
- 19 SQLite tables with FTS
- CI on every PR

## Architecture

User messages → WebSocket → Claude Agent SDK (in-process streaming) → Real-time callbacks → SQLite + activity tree.

**Stack**: Node.js / TypeScript / Express + Socket.IO / React 19 / SQLite / Electron

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
│   ├── src/components/  # 75 components
│   ├── src/hooks/       # 25 custom hooks
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

**Test suite**: 524 tests across core modules (config, auth, database, sdk-session, server) and features (search, logger, mcp-api, mcp-config).

#### Frontend Tests

**Run all tests**:
```bash
cd frontend && npm test
```

**Test suite**: 1,120 tests covering components, hooks, and utilities.

#### Test Policy

Tests are mandatory for all implementations:
- **New features**: Unit tests for logic + integration tests for flows
- **Bug fixes**: Regression test that fails without the fix, passes with it
- **Refactoring**: Existing tests pass before and after changes

Coverage targets: 80%+ on critical paths (sdk-session, database), 100% on utility functions (auth, config).

</details>

## Contributing

Fork, branch, test, PR. See [CLAUDE.md](CLAUDE.md) for conventions.

## License

MIT License. Copyright 2025-present Matias Fuentes. See [LICENSE](LICENSE).

---

<p align="center">
  Built with <a href="https://www.anthropic.com/claude">Claude</a> by <a href="https://github.com/kerplunkstudio">@kerplunkstudio</a>
</p>
