# cc+

The Claude Code experience you wish the terminal gave you.

cc+ wraps the Claude Code SDK in a lightweight IDE — tabbed sessions, a live activity tree, usage insights, and markdown that actually renders. Same engine underneath, better everything on top.

## Features

**A real activity tree.** See every agent spawn, every tool call, every nested hierarchy in real time. Not a log dump — a live, collapsible tree that shows you what's happening and where.

**Tabs that work.** Run multiple sessions side by side. Each tab gets its own isolated SDK worker. Switch between them without losing context or killing active queries.

**Session insights.** Token usage, tool success rates, agent durations, cost breakdowns — all stored in SQLite, all queryable. Know where your money goes.

**A desktop app.** Native window via Electron. Dock integration, window state persistence. Run it standalone or alongside the web UI — same backend either way.

**Proper markdown.** Conversations render like they should. Code blocks, tables, headings, inline formatting — not a wall of raw text.

## Getting started

**Requirements:** Python 3.12+, Node.js 18+, Claude Code CLI configured.

```bash
git clone https://github.com/Kerplunk-Studio/ccplus.git && cd ccplus
./setup.sh    # one-time install
./ccplus      # build, deploy, launch
```

That's it. `setup.sh` handles the venv, dependencies, and config. `./ccplus` builds the frontend, starts the server, and opens the desktop app. Run `./ccplus` every time you want to use it.

## Development

```bash
cd frontend && npm start        # Hot reload on :3001
./deploy.sh server              # Restart backend only
./deploy.sh stop                # Kill everything
```

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
