# Development Guide

## Prerequisites

- Node.js 18+ (for backend and frontend)
- Claude Code CLI installed and authenticated (uses your subscription)

## Initial Setup

**Quick start (recommended)**:
```bash
git clone git@github.com:kerplunkstudio/ccplus.git && cd ccplus
./ccplus             # Interactive setup + build + launch desktop app
```

The first run will:
1. Install backend-ts dependencies
2. Install frontend dependencies
3. Interactively configure `.env` (workspace path, model choice)
4. Build TypeScript backend
5. Build frontend and launch desktop app

**Manual setup** (if you prefer):
```bash
git clone git@github.com:kerplunkstudio/ccplus.git && cd ccplus

# TypeScript backend
cd backend-ts && npm install && npm run build && cd ..

# Frontend
cd frontend && npm install && cd ..

# Environment
cp .env.example .env
# Edit .env with your values (WORKSPACE_PATH, SDK_MODEL, etc.)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_PATH` | `~/Workspace` | Working directory for SDK sessions |
| `SDK_MODEL` | `sonnet` | Default model for SDK queries |
| `PORT` | `4000` | Server port |
| `CCPLUS_AUTH` | `local` | Auth mode (`local` for auto-login) |
| `SECRET_KEY` | `ccplus-dev-secret-change-me` | JWT signing key (change in production) |

## Running Locally

**First run** (automatic setup):
```bash
./ccplus             # Interactive setup + build + launch desktop app
```

The first time you run `./ccplus`, it will:
1. Check for prerequisites (Node 18+, Claude CLI)
2. Install backend-ts dependencies
3. Install frontend dependencies
4. Interactively configure `.env` (workspace path, model, etc.)
5. Build TypeScript backend
6. Build frontend and launch desktop app

**Subsequent runs** (launch desktop app):
```bash
./ccplus             # Build frontend + deploy + launch desktop app
```

**Health check**:
```bash
./ccplus doctor      # Run system diagnostics
```

**Desktop app variants**:
```bash
# Default: Exclusive mode (stops web server)
./ccplus
./ccplus desktop

# Parallel mode (runs alongside web server) - RECOMMENDED FOR DEVELOPMENT
./ccplus desktop-parallel

# Or use the standalone launcher:
./ccplus-desktop
```

**Web UI mode**:
```bash
./ccplus web         # Build frontend + deploy + start server
```

Access web UI at `http://localhost:4000`.

**Component-specific commands**:
```bash
./ccplus server      # Restart Node.js server
./ccplus backend     # Build TypeScript backend only
./ccplus frontend    # Build + deploy frontend only (no restart)
./ccplus stop        # Stop server
./ccplus setup       # Force re-run setup
```

**Manual (development, foreground)**:
```bash
cd backend-ts && npm run dev
```

## Frontend Development

```bash
cd frontend
npm start            # Dev server on port 3001 (proxies API to 3000)
npm run build        # Production build to frontend/build/
npm test             # Run React component tests
```

After modifying frontend source, deploy the build:
```bash
./ccplus             # Rebuilds, deploys, and launches desktop app
./ccplus web         # Rebuilds, deploys, and starts web server
```

**The build step matters**: Express serves from `static/chat/`, not from `frontend/src/`. If you edit source files but do not deploy, the browser shows stale code.

## Deploy Workflow

**Script**: `./ccplus` at project root.

| Command | What it does |
|---------|-------------|
| `./ccplus` or `./ccplus start` | Full deploy: build TypeScript backend, build frontend, deploy static, launch desktop app. On first run, runs interactive setup. Stops web server if running. |
| `./ccplus web` | Full deploy: build TypeScript backend, build frontend, deploy static, start web server. Active SDK sessions are interrupted on server restart (they run in-process). |
| `./ccplus doctor` | Run system diagnostics (Node version, environment, services, build status, database). |
| `./ccplus server` | Restart Node.js server (kills active SDK sessions since they run in-process). |
| `./ccplus backend` | Build TypeScript backend only (compiles to `dist/`). |
| `./ccplus frontend` | Build + deploy frontend only. No server restart. |
| `./ccplus desktop` | Launch Electron desktop app (stops web server, starts its own backend). Same as `./ccplus`. |
| `./ccplus desktop-parallel` | Launch Electron desktop app alongside web server (port 4001). **Recommended for development.** |
| `./ccplus stop` | Stop Node.js server. |
| `./ccplus setup` | Force re-run interactive setup (reinstalls deps, configures .env). |
| `./ccplus-desktop` | Standalone desktop app launcher (delegates to `./ccplus desktop`). |

**Deploy behavior**: The Node.js server runs SDK queries in-process (no separate worker). Server restart interrupts any active SDK sessions. Clients automatically reconnect via Socket.IO and can start new queries.

**After deploy**: Hard refresh browser (Cmd+Shift+R) to clear cached assets.

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
