<p align="center">
  <h1 align="center">cc+</h1>
</p>

<h3 align="center">Observability for Claude Code</h3>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.12%2B-blue?style=flat-square" alt="Python"/>
  <img src="https://img.shields.io/badge/react-19-61dafb?style=flat-square" alt="React"/>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"/>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#usage">Usage</a> •
  <a href="#development">Development</a> •
  <a href="#architecture">Architecture</a>
</p>

---

## What is cc+?

**cc+** is a web UI and desktop app for [Claude Code](https://docs.claude.com/claude-code). It provides a browser-based chat interface backed by the Claude Code SDK, with a real-time activity tree showing every agent spawn and tool call as it happens.

Same Claude Code underneath. Better window into it.

### Why?

You type in a terminal. Claude Code types back. Somewhere in between, it spawned 4 agents, edited 12 files, and ran tests you didn't know existed. You find out when it's done. Maybe.

**cc+ shows you all of it. In real time. As it happens.**

---

## Features

- **Direct SDK Integration** - No middleman. Your messages go straight to the Claude Code SDK. Whatever works in terminal, works here.
- **Real-time Activity Tree** - See every agent spawn, tool call, and file operation as it happens. Collapsible nodes, status indicators, execution hierarchy.
- **Streaming Responses** - Watch Claude think. Characters appear in real-time, not in 30-second bursts.
- **Web + Desktop** - Run in your browser or as a native desktop app (Electron).
- **Session Persistence** - Conversation history and tool usage stored in SQLite. Pick up where you left off.
- **Zero Configuration** - If Claude Code works in your terminal, cc+ works in your browser. No accounts, no API keys to paste.
- **WebSocket Protocol** - Live updates via Socket.IO. Cancel queries mid-flight.

---

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- `ANTHROPIC_API_KEY` environment variable (or Claude Code configured in terminal)

### Installation

```bash
# Clone the repository
git clone git@github.com:mjfuentes/ccplus.git
cd ccplus

# Install backend dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Install frontend dependencies
cd frontend && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# Build and run
./deploy.sh
```

Open `http://localhost:4000` in your browser.

---

## Usage

### Web UI

Default mode. Run the Flask server and access via browser:

```bash
./deploy.sh
```

Open `http://localhost:4000`. Start chatting with Claude Code.

### Desktop App

Run cc+ as a standalone desktop application (no browser needed):

```bash
./deploy.sh desktop
```

**Modes:**
- **Exclusive mode**: Stops web server, runs backend inside Electron
- **Parallel mode** (recommended for dev): Web server on port 4000, desktop app on port 4001

```bash
./deploy.sh desktop-parallel  # Both web and desktop run simultaneously
```

### What You See

```
┌─────────────────────────────────┬──────────────────────────┐
│                                 │  Activity                │
│  You: refactor auth to use JWT  │                          │
│                                 │  🤖 code_agent           │
│  cc+: On it. I'll refactor     │  ├── 🔧 Read auth.py     │
│  the auth module to use JWT     │  ├── 🔧 Edit auth.py     │
│  tokens instead of sessions...  │  ├── 🔧 Write tests.py   │
│                                 │  ├── 🔧 Bash pytest ✓    │
│  [streaming ▊]                  │  └── 🔧 Bash git commit ✓│
│                                 │                          │
│  ┌──────────────────────────┐   │  🤖 security-reviewer    │
│  │ Type a message...    Send│   │  ├── 🔧 Read auth.py     │
│  └──────────────────────────┘   │  └── 🔧 Grep "password" ✓│
└─────────────────────────────────┴──────────────────────────┘
```

**Left panel**: Chat with Claude Code
**Right panel**: Live activity tree showing every agent spawn, tool call, and execution status

---

## Architecture

### Stack

- **Backend**: Python 3.12, Flask, Flask-SocketIO, Claude Code SDK
- **Frontend**: React 19, TypeScript, Socket.IO client
- **Database**: SQLite (WAL mode, thread-safe)
- **Desktop**: Electron 28

### How It Works

```
Browser → WebSocket → Flask → Claude Code SDK → Streaming response
                                    ↓
                              SDK hooks track
                              tool events and
                              write to SQLite
                                    ↓
                              WebSocket emits
                              tool_event updates
                                    ↓
                              Activity tree
                              rebuilds in real-time
```

**No task queue. No orchestrator. No routing layer.**

User messages go straight to the Claude Code SDK. The SDK handles everything. cc+ just provides the UI and observability layer.

### Project Structure

```
ccplus/
├── backend/
│   ├── server.py          # Flask + WebSocket server
│   ├── sdk_session.py     # SDK session manager (asyncio loop in background thread)
│   ├── sdk_hooks.py       # Tool event tracking + agent stack correlation
│   ├── database.py        # SQLite operations (conversations + tool_usage)
│   ├── auth.py            # JWT auto-login for local mode
│   └── config.py          # Environment configuration
├── electron/
│   ├── main.js            # Electron main process
│   ├── preload.js         # IPC bridge
│   └── assets/            # App icons (.icns, .png, .ico)
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── ChatPanel.tsx       # Chat interface with streaming
│       │   ├── ActivityTree.tsx    # Real-time agent/tool tree
│       │   └── MessageBubble.tsx   # Markdown rendering
│       └── hooks/
│           ├── useSocket.ts        # WebSocket connection + activity tree reducer
│           └── useAuth.ts          # Auto-login flow
├── static/chat/           # Deployed frontend build (served by Flask)
├── data/                  # SQLite database (runtime, gitignored)
├── tests/                 # pytest test suite
└── deploy.sh              # Build + deploy + restart script
```

---

## Development

### Running Locally

**Full deploy** (build frontend + restart server):
```bash
./deploy.sh
```

**Server only** (no frontend rebuild):
```bash
./deploy.sh server
```

**Frontend only** (no server restart):
```bash
./deploy.sh frontend
```

**Desktop app** (parallel mode):
```bash
./deploy.sh desktop-parallel
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (required) | API key for Claude Code SDK |
| `WORKSPACE_PATH` | `~/Workspace` | Working directory for SDK sessions |
| `SDK_MODEL` | `sonnet` | Default model (`sonnet`, `opus`, `haiku`) |
| `PORT` | `4000` | Server port |
| `CCPLUS_AUTH` | `local` | Auth mode (`local` for auto-login) |
| `SECRET_KEY` | (auto-generated) | JWT signing key |

### Testing

**Backend tests** (pytest):
```bash
pytest tests/ -v
pytest tests/ --cov=backend --cov-report=html
```

**Frontend tests** (Jest + React Testing Library):
```bash
cd frontend && npm test
```

**Test coverage targets:**
- Critical paths (sdk_session, sdk_hooks, database): 80%+
- Utility functions (auth, config): 100%
- Server routes: Best effort

### Deploy Workflow

The `deploy.sh` script intelligently restarts only what changed:

- **Frontend changes**: Rebuilds React app, deploys to `static/chat/`, restarts Flask
- **Server changes**: Restarts Flask only. SDK worker stays alive.
- **Worker changes** (`sdk_worker.py`): Restarts SDK worker (interrupts active sessions)

**Deploy resilience**: The SDK worker is a separate process. During server-only restarts, the worker buffers events and replays them when Flask reconnects. Active SDK sessions survive.

---

## FAQ

**Is this a Claude Code replacement?**
No. It IS Claude Code. Same SDK, same agents, same tools. Different window.

**Why not just use the terminal?**
Use both. Terminal for quick stuff. cc+ when you want to actually see what 4 parallel agents are doing to your codebase.

**Does it cost more?**
Same tokens, same API calls. cc+ adds zero overhead. The UI is free. The agents bill the same.

**Can I use my existing `.claude/` config?**
Yes. cc+ reads your agent definitions, hooks, and settings. It's the same Claude Code.

**What about privacy?**
cc+ runs locally. No data leaves your machine except API calls to Anthropic (same as terminal). Conversations stored in local SQLite.

---

## Contributing

Contributions welcome! See [CLAUDE.md](CLAUDE.md) for development conventions and architecture details.

**Key areas:**
- Frontend improvements (React components, UI/UX)
- Test coverage (backend 80%+, frontend best effort)
- Desktop app features (window management, packaging)
- WebSocket protocol enhancements

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Same Claude Code. Better window.</strong>
</p>

<p align="center">
  <a href="https://docs.anthropic.com/">Anthropic Docs</a> •
  <a href="https://docs.claude.com/claude-code">Claude Code Docs</a> •
  <a href="CLAUDE.md">Developer Guide</a>
</p>
