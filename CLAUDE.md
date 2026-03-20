# cc+ - Claude Code Context

> Rules and conventions for Claude Code agents working on the cc+ codebase.

## Project Overview

cc+ is a web UI and observability layer for Claude Code. User messages go straight to the Claude Code SDK via WebSocket. The SDK does the work. cc+ shows you what it is doing.

**Stack**: Node.js / Claude Agent SDK / Express + Socket.IO / React 19 + TypeScript / SQLite

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

**Last Updated**: 2026-03-20
**Stack**: Node.js / Claude Agent SDK / Express + Socket.IO / React 19 + TypeScript / SQLite
