# Testing

## Backend Tests

**Location**: `backend-ts/src/__tests__/*.test.ts`

**Run all**:
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

**Test files**:
| File | Tests |
|------|-------|
| `config.test.ts` | Environment variable loading, defaults, directory creation (31 tests) |
| `database.test.ts` | CRUD operations, conversation history, tool events, stats, images |
| `logger.test.ts` | Log levels, log rotation, file operations (23 tests) |
| `mcp-api.test.ts` | MCP server operations, error handling (9 tests) |
| `mcp-config.test.ts` | Configuration validation, server lifecycle (22 tests) |
| `scheduler.test.ts` | Task scheduling, job management, error handling (43 tests) |
| `sdk-session.test.ts` | Session lifecycle, cancellation, callback dispatch, hooks |
| `search.test.ts` | Full-text search across sessions and messages (11 tests) |
| `server.test.ts` | HTTP routes, WebSocket events, auth flow, health check |
| `utils.test.ts` | Utility functions, helpers (13 tests) |

**Framework**: Vitest with TypeScript support

**Total tests**: 456 tests across 10 test files

**Coverage targets**:
- Critical paths (sdk-session, database): 80%+
- Utility functions (auth, config): 100%
- Server routes: Best effort

## Frontend Tests

**Location**: `frontend/src/{components,hooks,contexts,theme,utils}/*.test.{tsx,ts}`

**Run**:
```bash
cd frontend && npm test -- --watchAll=false
```

**Framework**: Jest + React Testing Library

**Test files**: 53 test files across the frontend covering:
- **Components** (35 files): ChatPanel, ActivityTree, MessageBubble, ModelSelector, MCPPanel, PluginMarketplace, ProjectDashboard, SessionDashboard, TabBar, WelcomeScreen, and more
- **Hooks** (13 files): useSocket, useActivityTree, usePlugins, useScheduler, useSessionActions, useWorkspace, and more
- **Contexts** (1 file): ToastContext
- **Theme** (2 files): ThemeContext, applyTheme
- **Utils** (2 files): formatToolLabel, slashCommands

**Total tests**: 1,119 tests (8 skipped) across 53 test files

## Test Policy

Tests are mandatory for all implementations:
- New features: Unit tests for logic + integration tests for flows
- Bug fixes: Regression test that fails without the fix
- Refactoring: Existing tests pass before and after
