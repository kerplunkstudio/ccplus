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

## Packaging the Desktop App

When changes affect `electron/main.js`, `electron/preload.js`, or anything that impacts the packaged desktop app (not just hot-reloadable frontend/backend):

```bash
./ccplus package     # Build everything + package + install to /Applications
```

This rebuilds backend + frontend, runs electron-builder, quits any running instance, installs CC+.app to /Applications, clears quarantine, and re-registers with Launch Services. The Dock icon will work immediately after.

**When to run `./ccplus package`:**
- Changes to `electron/main.js` or `electron/preload.js`
- Changes to Electron dependencies in root `package.json`
- Changes to the `build` config in root `package.json`
- After upgrading the SDK if it changes server log formats or startup behavior
- When the user asks to rebuild or fix the desktop app

## Config changes

(`.env`, `config.ts`): Requires backend restart.

## Auto-Deploy After Changes

When working as a Claude Code agent:
- **Automatically run `./ccplus frontend`** after frontend changes
- **Automatically run `cd backend-ts && npm run build`** after backend changes
- **Automatically run `./ccplus package`** after Electron or packaging changes
- Only run full `./ccplus` if the user is not currently running the app or explicitly asks for full redeploy

**When to skip**: Only skip deploy if the user explicitly says "don't deploy" or the change is in `tests/`, `docs/`, or `.env`.
