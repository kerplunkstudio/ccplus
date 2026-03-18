---
description: "Playbook for deploying cc+ changes: frontend, backend, or full stack"
---

# Deploy Workflow

Quick reference for deploying cc+ changes. Choose the right command based on what changed.

## Frontend-Only Changes

**When**: Modified `frontend/src/` files (components, hooks, types, CSS)

```bash
./ccplus frontend
```

This:
1. Builds frontend (`cd frontend && npm run build`)
2. Deploys to `static/chat/`
3. No server restart (running backend is not affected)

**After deploy**: Hard refresh browser (Cmd+Shift+R) to clear cached assets.

**Why needed**: Express serves from `static/chat/`, not `frontend/src/`. Without build+deploy, browser shows stale code.

## Backend-Only Changes

**When**: Modified `backend-ts/src/*.ts` files (server, database, auth, SDK session)

```bash
cd backend-ts && npm run build
./ccplus server
```

This:
1. Compiles TypeScript to `backend-ts/dist/`
2. Restarts Node.js server (kills active SDK sessions)

**Warning**: Server restart interrupts any active SDK queries (they run in-process). Clients auto-reconnect and can start new queries.

## Full Deploy

**When**: Both frontend and backend changed, or unsure what changed

```bash
./ccplus web        # For web server mode
# OR
./ccplus            # For desktop app mode
```

This:
1. Builds TypeScript backend
2. Builds frontend
3. Deploys static files
4. Starts web server (web mode) or launches desktop app (desktop mode)

**First run**: Automatically runs interactive setup (installs deps, configures `.env`)

## Desktop App Development

**Recommended for development**: Run desktop app alongside web server

```bash
./ccplus desktop-parallel
```

This:
- Launches Electron app on port 4001
- Web server continues running on port 4000
- Both share the same SDK worker
- Allows testing web and desktop interfaces simultaneously

**Exclusive mode** (stops web server):
```bash
./ccplus desktop
# OR
./ccplus
```

## Component-Specific Commands

| Command | What it does |
|---------|-------------|
| `./ccplus backend` | Build TypeScript backend only (no restart) |
| `./ccplus frontend` | Build + deploy frontend only (no restart) |
| `./ccplus server` | Restart Node.js server (kills active SDK sessions) |
| `./ccplus stop` | Stop Node.js server |
| `./ccplus setup` | Force re-run interactive setup |

## Verification Steps

After deployment, verify:

1. **Health check**:
   ```bash
   curl http://localhost:4000/health
   ```
   Should return JSON with uptime, sessions, clients, DB stats.

2. **Frontend assets**:
   ```bash
   ls -lh static/chat/index.html
   ```
   Should show recent timestamp.

3. **Backend build**:
   ```bash
   ls -lh backend-ts/dist/server.js
   ```
   Should show recent timestamp.

4. **Server logs**:
   ```bash
   tail -f logs/server.log
   ```
   Should show recent activity, no errors.

5. **WebSocket connection**: Open browser, check console for "Connected to cc+ server" message.

## Common Issues

### Stale Cache

**Symptom**: Frontend changes not visible after deploy.

**Fix**: Hard refresh browser (Cmd+Shift+R). Or clear browser cache entirely.

### Port Already in Use

**Symptom**: `Error: listen EADDRINUSE: address already in use :::4000`

**Fix**:
```bash
./ccplus stop
# Wait 2 seconds
./ccplus web
```

Or kill the process manually:
```bash
lsof -ti:4000 | xargs kill -9
```

### Build Failures

**Symptom**: TypeScript compilation errors or frontend build errors.

**Fix**: Check error output. Common causes:
- Missing dependencies: Run `cd backend-ts && npm install` or `cd frontend && npm install`
- TypeScript errors: Fix source files, run `cd backend-ts && npm run build`
- Frontend errors: Fix source files, run `cd frontend && npm run build`

### SDK Session Interrupted

**Symptom**: Active SDK query stops mid-execution after restart.

**Why**: SDK queries run in-process. Server restart kills them.

**Fix**: This is expected behavior. Start a new query after server restart.

### Database Lock

**Symptom**: `Error: database is locked` in logs.

**Fix**: SQLite uses WAL mode for concurrent reads. Lock should be rare. If persistent:
```bash
./ccplus stop
# Wait for WAL checkpoint
sleep 2
./ccplus web
```

## Development Workflow

**Typical flow**:
1. Make changes to source files
2. Run `./ccplus frontend` (frontend) or `cd backend-ts && npm run build && ./ccplus server` (backend)
3. Verify changes in browser/desktop app
4. Run tests: `cd backend-ts && npm test` or `cd frontend && npm test`
5. Commit changes
6. Repeat

**Hot reload**: Not supported. Must run deploy command after each change.

**Parallel development**: Use `./ccplus desktop-parallel` to run web and desktop simultaneously.

## Environment Changes

**When**: Modified `.env` or `backend-ts/src/config.ts`

**Required**: Backend restart (config is loaded on startup)

```bash
./ccplus server
```

Verify new config:
```bash
curl http://localhost:4000/health | jq .
```
