# cc+

The Claude Code experience you wish the terminal gave you.

cc+ wraps the Claude Code SDK in a lightweight IDE — tabbed sessions, a live activity tree, usage insights, and markdown that actually renders. Same engine underneath, better everything on top.

## Features

**A real activity tree.** See every agent spawn, every tool call, every nested hierarchy in real time. Not a log dump — a live, collapsible tree that shows you what's happening and where.

**Tabs that work.** Run multiple sessions side by side. Each tab gets its own isolated SDK worker. Switch between them without losing context or killing active queries.

**Session insights.** Token usage, tool success rates, agent durations, cost breakdowns — all stored in SQLite, all queryable. Know where your money goes.

**A desktop app.** Native window via Electron. Dock integration, window state persistence. Run it standalone or alongside the web UI — same backend either way.

**Workspace browser.** Browse your filesystem and select project directories from the UI. Auto-detects git repos under common workspace paths.

**First-run onboarding.** Welcome screen with example prompts, detected projects, and workspace setup — shown automatically on first launch.

**Proper markdown.** Conversations render like they should. Code blocks, tables, headings, inline formatting — not a wall of raw text.

**One-line install.** `curl | bash` installer that checks prereqs, clones the repo, and starts the server.

## Getting started

**Requirements:** Python 3.12+, Node.js 18+, Claude Code CLI configured.

```bash
# One-line installer (recommended)
curl -fsSL https://raw.githubusercontent.com/Kerplunk-Studio/ccplus/main/install.sh | bash

# Or manual install
git clone https://github.com/Kerplunk-Studio/ccplus.git && cd ccplus
./ccplus      # auto-setup on first run, build + deploy + launch on subsequent runs
```

That's it. First run auto-detects missing dependencies, creates the venv, installs packages, runs interactive `.env` setup, builds the frontend, and starts the server. Just run `./ccplus` every time you want to use it.

## Development

```bash
cd frontend && npm start        # Hot reload on :3001
./ccplus server                 # Restart backend only
./ccplus frontend               # Rebuild + deploy frontend only
./ccplus doctor                 # System health check
./ccplus stop                   # Kill everything
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `./ccplus` | Smart deploy (first run: setup, subsequent: build + restart) |
| `./ccplus status` | Show service status |
| `./ccplus doctor` | System health check |
| `./ccplus stop` | Stop all services |
| `./ccplus logs` | Tail all logs |
| `./ccplus desktop` | Launch Electron desktop app |
| `./ccplus desktop-parallel` | Desktop + web server side by side |
| `./ccplus release [type]` | Create release (patch/minor/major) |
| `./ccplus check-update` | Check for new versions |
| `./ccplus update` | Update to latest |
| `./ccplus setup` | Force re-run setup |

## Architecture

The design is deliberately simple. No routing layer, no orchestrator, no queue. User messages go straight to the Claude Code SDK via WebSocket. The SDK does the work. cc+ shows you what it's doing.

```
Browser → Flask-SocketIO → SDK (asyncio loop in daemon thread)
   ↑                               ↓
   └──────── WebSocket events ─────┘
```

Flask serves the React frontend and handles WebSocket connections. The SDK session manager runs queries in a background thread with its own asyncio loop. Callbacks stream text deltas and tool events back to the browser via SocketIO rooms. SQLite stores everything with thread-local connections for concurrency.

The activity tree is built client-side from flat event streams using an immutable reducer. Agent spawns create nodes, tool calls attach as children, completions update status. Parent-child correlation happens via a stack in the backend hook layer.

**Core files:**
- `backend/server.py` — Flask routes, WebSocket handlers
- `backend/sdk_session.py` — SDK lifecycle, streaming callbacks
- `backend/sdk_hooks.py` — Tool event tracking, agent stack, dangerous command blocking
- `frontend/src/hooks/useSocket.ts` — WebSocket client, activity tree reducer
- `frontend/src/components/ActivityTree.tsx` — Real-time tree visualization

Full architecture docs, database schema, WebSocket protocol, and development conventions live in [CLAUDE.md](CLAUDE.md).

## Testing

**Backend:**
```bash
pytest tests/ -v                              # All tests
pytest tests/ --cov=backend --cov-report=html # With coverage
```

**Frontend:**
```bash
cd frontend && npm test
```

Coverage targets: 80%+ on critical paths (SDK session, hooks, database), 100% on utilities, best effort on routes.

## Contributing

Fork, branch, PR. Make sure tests pass before submitting.

Backend changes need backend tests. Frontend changes need component tests. New features need both. Bug fixes need regression tests that fail without the fix.

Run `pytest tests/ -v` and `cd frontend && npm test` before pushing.

## License

MIT. Do what you want with it.

Author: mjfuentes
