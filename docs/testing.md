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
| `config.test.ts` | Environment variable loading, defaults, directory creation (6 tests) |
| `auth.test.ts` | JWT generation, verification, expiry, local mode (12 tests) |
| `database.test.ts` | CRUD operations, conversation history, tool events, stats, images (58 tests) |
| `sdk-session.test.ts` | Session lifecycle, cancellation, callback dispatch, hooks (29 tests) |
| `server.test.ts` | HTTP routes, WebSocket events, auth flow, health check (44 tests) |

**Framework**: Vitest with TypeScript support

**Total tests**: 149 tests across 5 test files

**Coverage targets**:
- Critical paths (sdk-session, database): 80%+
- Utility functions (auth, config): 100%
- Server routes: Best effort

## Frontend Tests

**Location**: `frontend/src/components/*.test.tsx`

**Run**:
```bash
cd frontend && npm test
```

**Framework**: Jest + React Testing Library

**Test files**:
- `ChatPanel.test.tsx`
- `ActivityTree.test.tsx`
- `MessageBubble.test.tsx`

## Test Policy

Tests are mandatory for all implementations:
- New features: Unit tests for logic + integration tests for flows
- Bug fixes: Regression test that fails without the fix
- Refactoring: Existing tests pass before and after
