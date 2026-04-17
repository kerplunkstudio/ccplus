# cc+ - Claude Code Context

> Rules and conventions for Claude Code agents working on the cc+ codebase.

## Project Overview

cc+ is a fleet-orchestration platform for Claude Code. It provides real-time observability of SDK sessions, a persistent autonomous orchestrator (Captain) that spins up parallel sessions in isolated git worktrees, a self-improving loop (KAIROS) that analyzes completed sessions and evolves agent prompts, a multi-tier self-gardening memory system, and bridges to Telegram and voice. Users can run sessions manually or let Captain drive entire workflows end-to-end.

**Stack**: Node.js / Claude Agent SDK / Express + Socket.IO / React 19 + TypeScript / SQLite / Captain / KAIROS / Fleet / Telegram bot / Memory system

## Quick Reference

### Component Locations
See `.claude/rules/component-locations.md` for comprehensive file reference covering:
- Backend components (server.ts, sdk-session.ts, database.ts, etc.)
- Frontend components (hooks, components, types)
- Desktop app structure
- Configuration constants

### Reference Documentation
- **Architecture**: See `docs/architecture.md` for message flow, async model, WebSocket protocol, tool event types.
- **Database**: See `docs/database.md` for schema and common queries.
- **Development**: See `docs/development.md` for setup, environment variables, running locally, deploy workflow, HTTP API.
- **Testing**: See `docs/testing.md` for test commands, coverage targets, and test policy.
- **Captain**: `backend-ts/src/captain.ts` (orchestrator core), `captain-tools.ts` (MCP fleet-control tools), `captain-router.ts` (message routing), `captain-tick.ts` (periodic tick), `captain-prompt.ts`, `captain-memory.ts`, `captain-auth.ts`.
- **KAIROS**: `backend-ts/src/kairos-daemon.ts` (tick-triggered batch trigger), `kairos-runner.ts` (session runner), `kairos-prompt.ts`, `kairos-prompt-patcher.ts` (prompt evolution).
- **Fleet**: `backend-ts/src/fleet-monitor.ts` (session registry + status), `git-operations.ts` (worktree creation), `trust-score.ts`, `circuit-breaker.ts`.
- **Memory**: `backend-ts/src/memory-client.ts` (MCP client), `memory-distiller.ts`, `memory-gc.ts`, `memory-promotion.ts`.
- **Bridges**: `backend-ts/src/telegram-bridge.ts` + `telegram-format.ts`, `voice-transcriber.ts` (Whisper), `pty-service.ts`.
- **Domain modules**: `backend-ts/src/routes/` (HTTP handlers), `backend-ts/src/db/` (SQLite per-domain), `backend-ts/src/sdk/` (SDK hooks).

## Run Modes

cc+ runs in three modes:

1. **Desktop app** (default): Electron window, stops web server
2. **Desktop app (parallel)**: Electron + web server on port 4001 (RECOMMENDED FOR DEVELOPMENT)
3. **Web UI**: Browser access at `localhost:4000`

Use `./ccplus desktop-parallel` for development to allow both interfaces simultaneously.

## Repository Conventions

### Backend Style

- Use TypeScript strict mode
- Use ESM modules (`.js` imports in `.ts` files)
- Use better-sqlite3 synchronous API (singleton connection)
- Use async/await for all SDK operations
- Maximum line length: 120 characters
- File naming: `kebab-case.ts`

### Frontend Style

- Use TypeScript strict mode, all props and state typed
- Use React hooks + useReducer (no external state library)
- Create new objects for all state updates (immutable patterns REQUIRED)
- Use functional components only (no class components)

### Naming Conventions

- **Backend TypeScript files**: `kebab-case.ts` (server.ts, sdk-session.ts, database.ts)
- **Backend TypeScript interfaces**: `PascalCase`
- **Backend TypeScript functions**: `camelCase()`
- **Backend TypeScript constants**: `UPPER_SNAKE_CASE`
- **Frontend TypeScript files**: `PascalCase.tsx` for components, `camelCase.ts` for hooks/utilities
- **Frontend TypeScript interfaces**: `PascalCase`
- **CSS files**: Match component name (`ChatPanel.css`, `ActivityTree.css`)

### File Organization

```
ccplus/
├── backend-ts/
│   ├── src/
│   │   ├── server.ts          # Express + Socket.IO (entry point)
│   │   ├── sdk-session.ts     # SDK session lifecycle + hooks
│   │   ├── database.ts        # SQLite operations (better-sqlite3)
│   │   ├── config.ts          # Environment config
│   │   ├── doctor.ts          # System diagnostics
│   │   ├── logger.ts          # Application logging
│   │   ├── mcp-config.ts      # MCP server configuration
│   │   ├── scheduler.ts       # Task scheduling
│   │   ├── utils.ts           # Shared utilities
│   │   └── __tests__/         # Vitest tests
│   ├── dist/                  # Compiled JS (gitignored)
│   ├── package.json
│   └── tsconfig.json
├── electron/
│   ├── main.js                # Electron main process
│   ├── preload.js             # IPC bridge
│   └── assets/                # App icons
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── types/
│   ├── package.json
│   └── build/                 # Generated (gitignored)
├── static/chat/               # Deployed build (gitignored)
├── data/                      # SQLite DB (gitignored)
├── logs/                      # Server logs (gitignored)
└── docs/                      # Reference documentation
```

## Common Pitfalls

See `.claude/rules/pitfalls.md` for detailed solutions to:
1. Forgetting to deploy frontend changes
2. better-sqlite3 synchronous behavior
3. Agent parent correlation
4. Cooperative cancellation
5. Socket.IO room vs sid confusion
6. Large parameter serialization
7. Dynamic vs static imports

## Development Workflow

See `.claude/rules/deploy.md` for:
- How to deploy frontend/backend changes while app is running
- When to use `./ccplus frontend` vs `./ccplus`
- Auto-deploy conventions for Claude Code agents

## Git & PR Policies

See `.claude/rules/git-workflow.md` for:
- Commit message format (conventional commits)
- PR merge requirements (bug fixes, features, tests)
- Never commit list (`.env`, `data/`, `logs/`, `node_modules/`, `dist/`, `build/`, `static/chat/`)

## Multi-Agent Safety

See `.claude/rules/agents.md` for:
- Git state protection (no stash, no branch switching)
- Scope discipline (only modify assigned files)
- Conflict prevention (check recent changes before editing shared files)

---

**Last Updated**: 2026-04-17
**Stack**: Node.js / Claude Agent SDK / Express + Socket.IO / React 19 + TypeScript / SQLite / Captain / KAIROS / Fleet / Telegram bot / Memory system
