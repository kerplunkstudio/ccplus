# Contributing to cc+

Thank you for your interest in contributing to cc+! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js 18+** (check with `node --version`)
- **Claude Code CLI** installed and authenticated
- Git

### Getting Started

```bash
# Clone the repository
git clone https://github.com/kerplunkstudio/ccplus.git
cd ccplus

# Install dependencies and build (interactive setup on first run)
./ccplus

# Or set up manually:
cd backend-ts && npm install && npm run build && cd ..
cd frontend && npm install && cd ..
cp .env.example .env
# Edit .env with your values (WORKSPACE_PATH, SDK_MODEL, etc.)
```

## Project Structure

```
ccplus/
├── backend-ts/          # Node.js + Express + Socket.IO backend
│   ├── src/
│   │   ├── server.ts           # Express server + WebSocket handlers
│   │   ├── sdk-session.ts      # Claude Code SDK session manager
│   │   ├── database.ts         # SQLite operations (better-sqlite3)
│   │   ├── auth.ts             # JWT authentication
│   │   ├── config.ts           # Environment configuration
│   │   └── __tests__/          # Vitest test suite
│   └── dist/                   # Compiled TypeScript (gitignored)
├── electron/            # Desktop app wrapper
│   ├── main.js                 # Electron main process
│   ├── preload.js              # IPC bridge
│   └── assets/                 # App icons
├── frontend/            # React 19 + TypeScript UI
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/         # ChatPanel, ActivityTree, MessageBubble
│   │   ├── hooks/              # useSocket, useAuth
│   │   └── types/              # TypeScript interfaces
│   └── build/                  # Build output (gitignored)
└── static/chat/         # Deployed frontend (served by Express, gitignored)
```

## Development Workflow

### Backend Development

**Watch mode** (auto-recompile on save):
```bash
cd backend-ts
npm run dev
```

**Build only**:
```bash
cd backend-ts
npm run build
```

**Run tests**:
```bash
cd backend-ts
npm test                    # Run all tests
npm run test:coverage       # With coverage report
npx vitest run src/__tests__/database.test.ts  # Specific test file
```

### Frontend Development

**Dev server** (hot reload on port 3001, proxies API to port 4000):
```bash
cd frontend
npm start
```

**Build + deploy**:
```bash
./ccplus frontend       # Build and deploy to static/chat/ (no backend restart)
```

**Run tests**:
```bash
cd frontend
npm test
```

### Full Rebuild + Deploy

```bash
./ccplus                # Build backend + frontend + launch desktop app
./ccplus web            # Build backend + frontend + start web server
```

**After frontend changes**: Hard refresh browser (Cmd+Shift+R) to clear cache.

## Code Style

### Backend (TypeScript)

- **Strict mode**: `tsconfig.json` has `strict: true`
- **Modules**: ESM (`import`/`export`, `.js` imports in `.ts` files)
- **File naming**: `kebab-case.ts` (e.g., `sdk-session.ts`, `database.ts`)
- **Functions**: `camelCase()`
- **Interfaces**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Line length**: 120 characters max
- **Database**: Synchronous better-sqlite3 API, singleton connection
- **Async**: Use `async`/`await`, no blocking in event loop

### Frontend (TypeScript + React)

- **Strict mode**: `tsconfig.json` has `strict: true`
- **Components**: Functional components only (no class components)
- **File naming**: `PascalCase.tsx` for components, `camelCase.ts` for hooks/utilities
- **Props and state**: Fully typed with TypeScript interfaces
- **Immutability**: All state updates create new objects (no mutations)
- **State management**: React hooks + `useReducer` for complex state (no external libraries)
- **CSS**: Scoped to component (`ChatPanel.css`, `ActivityTree.css`)

**Example immutability pattern**:
```typescript
// WRONG: Mutation
function updateNode(node: ActivityNode, status: string) {
  node.status = status;  // MUTATION!
  return node;
}

// CORRECT: Immutability
function updateNode(node: ActivityNode, status: string): ActivityNode {
  return { ...node, status };
}
```

## Testing Requirements

All new features and bug fixes MUST include tests.

### Backend Tests (Vitest)

- **Location**: `backend-ts/src/__tests__/*.test.ts`
- **Framework**: Vitest with TypeScript support
- **Coverage**: 80%+ on critical paths (sdk-session, database), 100% on utilities (auth, config)
- **Run before commit**: `cd backend-ts && npm test` must pass

**Test structure**:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { myFunction } from '../my-module.js';

describe('MyModule', () => {
  it('should handle typical case', () => {
    const result = myFunction(input);
    expect(result).toBe(expected);
  });

  it('should handle edge case', () => {
    // Test boundary conditions
  });

  it('should throw error on invalid input', () => {
    expect(() => myFunction(invalidInput)).toThrow();
  });
});
```

### Frontend Tests (Jest + React Testing Library)

- **Location**: `frontend/src/components/*.test.tsx`
- **Framework**: Jest + React Testing Library
- **Run before commit**: `cd frontend && npm test` must pass

**Test structure**:
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('handles user interaction', () => {
    render(<MyComponent />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Updated Text')).toBeInTheDocument();
  });
});
```

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructuring (no behavior change)
- `docs`: Documentation only
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, build scripts)
- `perf`: Performance improvements
- `ci`: CI/CD pipeline changes

**Examples**:
```
feat: add session duplication to frontend
fix: prevent memory leak in activity tree reducer
refactor: extract socket callbacks to separate module
docs: update CLAUDE.md with testing policy
test: add coverage for SDK session cancellation
```

## Pull Request Process

1. **Fork** the repository
2. **Create a branch**: `git checkout -b feature/my-feature` or `fix/my-bugfix`
3. **Make changes**: Follow code style and testing requirements
4. **Run tests**: Ensure all tests pass (`npm test` in both `backend-ts/` and `frontend/`)
5. **Commit**: Use conventional commit messages
6. **Push**: `git push origin feature/my-feature`
7. **Open PR**: Describe changes, link related issues, include test results

**PR checklist**:
- [ ] All tests pass
- [ ] New tests added for new features/fixes
- [ ] Code follows style guidelines
- [ ] No `console.log` statements (use proper logging)
- [ ] No hardcoded secrets or API keys
- [ ] Documentation updated (if applicable)

## Reporting Bugs

Open a [GitHub Issue](https://github.com/kerplunkstudio/ccplus/issues) with:
- **Description**: What happened vs. what you expected
- **Steps to reproduce**: Minimal example to trigger the bug
- **Environment**: OS, Node.js version, cc+ version
- **Logs**: Relevant output from `logs/server.log` or browser console

## Requesting Features

Open a [GitHub Issue](https://github.com/kerplunkstudio/ccplus/issues) with:
- **Use case**: What problem does this solve?
- **Proposed solution**: How should it work?
- **Alternatives**: Other approaches you considered

## Development Tips

### Debugging

**Backend logs**:
```bash
tail -f logs/server.log
```

**Database inspection**:
```bash
sqlite3 data/ccplus.db
.tables
SELECT * FROM conversations ORDER BY timestamp DESC LIMIT 10;
```

**Health check**:
```bash
curl http://localhost:4000/health | jq
```

### Common Issues

**Frontend changes not reflecting**:
- Run `./ccplus frontend` to rebuild and deploy
- Hard refresh browser (Cmd+Shift+R)

**Backend changes not reflecting**:
- Run `cd backend-ts && npm run build` to recompile
- Restart server: `./ccplus server`

**Tests failing**:
- Check for stale test databases: `rm -rf backend-ts/src/__tests__/test-*.db`
- Clear frontend cache: `cd frontend && npm test -- --clearCache`

## Questions?

Open a [GitHub Discussion](https://github.com/kerplunkstudio/ccplus/discussions) or reach out on the project repository.

---

**Author**: Matias Fuentes
**GitHub**: https://github.com/kerplunkstudio/ccplus
