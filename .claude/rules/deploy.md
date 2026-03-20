# Deploy Workflow

How to deploy changes while developing cc+.

## Overview

The desktop app and web server serve the frontend from `static/chat/`, NOT from `frontend/src/`. You MUST deploy for changes to take effect.

## Frontend changes (while app is running)

```bash
./ccplus frontend    # Builds + deploys to static/chat/ (no restart)
```
Then hard refresh in the app (Cmd+Shift+R).

## Backend TypeScript changes (while app is running)

```bash
cd backend-ts && npm run build   # Compile TypeScript to dist/
```
Then restart: `./ccplus server` (web mode) or relaunch desktop app.

## Full rebuild + launch (from scratch or when both changed)

```bash
./ccplus             # Build backend + frontend + deploy + launch desktop app
./ccplus web         # Same but starts web server instead
```

## Config changes

(`.env`, `config.ts`): Requires backend restart.

## Auto-Deploy After Changes

When working as a Claude Code agent:
- **Automatically run `./ccplus frontend`** after frontend changes
- **Automatically run `cd backend-ts && npm run build`** after backend changes
- Only run full `./ccplus` if the user is not currently running the app or explicitly asks for full redeploy

**When to skip**: Only skip deploy if the user explicitly says "don't deploy" or the change is in `tests/`, `docs/`, or `.env`.
