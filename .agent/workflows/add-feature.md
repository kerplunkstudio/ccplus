---
description: "Playbook for implementing new features in cc+: planning, backend, frontend, testing, deployment"
---

# Add Feature Workflow

Structured approach for implementing new features in cc+.

## Phase 1: Planning

Use the planner agent to create an implementation plan:

```bash
# In Claude Code or cc+ UI
@planner Create implementation plan for [feature description]
```

**Planner output includes**:
- Feature scope and requirements
- Affected components (backend, frontend, database)
- Step-by-step implementation guide
- Testing strategy
- Security considerations
- Rollout plan

**Review plan before starting**: Ensure all dependencies are identified and approach is sound.

## Phase 2: Backend Changes

### Database Schema Changes

**When**: Feature requires new tables or columns.

**Location**: `backend-ts/src/database.ts`

1. **Add migration function**:
   ```typescript
   export function migrateToV2(): void {
       db.exec(`
           ALTER TABLE conversations ADD COLUMN metadata TEXT;
           CREATE INDEX idx_conversations_metadata ON conversations(metadata);
       `);
   }
   ```

2. **Update schema version** in `initDatabase()`.

3. **Test migration**:
   ```bash
   cd backend-ts && npm test -- database.test.ts
   ```

### API Endpoints

**When**: Feature needs new HTTP routes.

**Location**: `backend-ts/src/server.ts`

1. **Add route handler**:
   ```typescript
   app.post('/api/feature', authenticateToken, (req, res) => {
       // Validate input
       // Call database/SDK functions
       // Return JSON response
   });
   ```

2. **Add error handling**: Wrap in try/catch, return consistent error format.

3. **Test endpoint**:
   ```bash
   curl -X POST http://localhost:4000/api/feature \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"param": "value"}'
   ```

### SDK Integration

**When**: Feature interacts with Claude Code SDK.

**Location**: `backend-ts/src/sdk-session.ts`

1. **Add hook callback** if needed (PreToolUse, PostToolUse, PostToolUseFailure).

2. **Update `buildSocketCallbacks()`** if feature needs real-time events.

3. **Test SDK interaction**: Send test message, verify hooks fire correctly.

### Build and Deploy Backend

```bash
cd backend-ts && npm run build
./ccplus server
```

## Phase 3: Frontend Changes

### Type Definitions

**Location**: `frontend/src/types/index.ts`

1. **Add interfaces** for new data structures:
   ```typescript
   export interface FeatureData {
       id: string;
       name: string;
       metadata: Record<string, unknown>;
   }
   ```

2. **Export** from index.ts.

### Components

**Location**: `frontend/src/components/`

1. **Create new component**:
   ```typescript
   // FeaturePanel.tsx
   import React, { useState } from 'react';
   import './FeaturePanel.css';

   interface FeaturePanelProps {
       data: FeatureData;
       onAction: (id: string) => void;
   }

   export function FeaturePanel({ data, onAction }: FeaturePanelProps): JSX.Element {
       // Component implementation
   }
   ```

2. **Add CSS file** (`FeaturePanel.css`).

3. **Export** from `components/index.ts`.

### Hooks

**Location**: `frontend/src/hooks/`

**When**: Feature needs state management or side effects.

1. **Create custom hook**:
   ```typescript
   // useFeature.ts
   import { useState, useEffect } from 'react';

   export function useFeature(param: string) {
       const [data, setData] = useState(null);
       const [loading, setLoading] = useState(false);

       useEffect(() => {
           // Fetch data, subscribe to events, etc.
       }, [param]);

       return { data, loading };
   }
   ```

2. **Export** from `hooks/index.ts`.

### Integration

**Location**: `frontend/src/App.tsx`

1. **Import** new component.

2. **Wire into UI**: Add to JSX tree with proper props.

3. **Connect WebSocket events** if needed (in `useSocket.ts`).

### Build and Deploy Frontend

```bash
./ccplus frontend
```

**Verify**: Hard refresh browser (Cmd+Shift+R), test feature.

## Phase 4: Testing

### Backend Tests

**Location**: `backend-ts/src/__tests__/`

1. **Create test file** (e.g., `feature.test.ts`):
   ```typescript
   import { describe, it, expect, beforeEach, afterEach } from 'vitest';
   import { initDatabase, addFeature, getFeature } from '../database.js';

   describe('Feature', () => {
       beforeEach(() => {
           initDatabase(':memory:');
       });

       it('should add feature', () => {
           const id = addFeature({ name: 'test' });
           expect(id).toBeDefined();
       });

       it('should retrieve feature', () => {
           const id = addFeature({ name: 'test' });
           const feature = getFeature(id);
           expect(feature.name).toBe('test');
       });
   });
   ```

2. **Run tests**:
   ```bash
   cd backend-ts && npm test
   ```

3. **Check coverage**:
   ```bash
   cd backend-ts && npm run test:coverage
   ```

**Target**: 80%+ coverage for critical paths, 100% for utility functions.

### Frontend Tests

**Location**: `frontend/src/components/`

1. **Create test file** (e.g., `FeaturePanel.test.tsx`):
   ```typescript
   import React from 'react';
   import { render, screen, fireEvent } from '@testing-library/react';
   import { FeaturePanel } from './FeaturePanel';

   describe('FeaturePanel', () => {
       it('renders feature name', () => {
           const data = { id: '1', name: 'Test Feature', metadata: {} };
           render(<FeaturePanel data={data} onAction={() => {}} />);
           expect(screen.getByText('Test Feature')).toBeInTheDocument();
       });

       it('calls onAction when button clicked', () => {
           const onAction = jest.fn();
           const data = { id: '1', name: 'Test', metadata: {} };
           render(<FeaturePanel data={data} onAction={onAction} />);
           fireEvent.click(screen.getByRole('button'));
           expect(onAction).toHaveBeenCalledWith('1');
       });
   });
   ```

2. **Run tests**:
   ```bash
   cd frontend && npm test
   ```

### Integration Testing

**Manual verification**:
1. Start app: `./ccplus desktop-parallel`
2. Test feature end-to-end (user interaction → backend → database → UI update)
3. Check error handling (invalid input, network errors, etc.)
4. Check edge cases (empty state, max values, special characters)

**Use E2E agent for critical flows**:
```bash
@e2e-runner Test the new feature workflow
```

## Phase 5: Code Review

Use code-reviewer agent:

```bash
@code-reviewer Review feature implementation
```

**Address**:
- CRITICAL issues (security, data loss, crashes)
- HIGH issues (bugs, performance, incorrect behavior)
- MEDIUM issues (code quality, maintainability)

**Optional**: LOW issues (style, minor improvements)

## Phase 6: Security Review

For security-sensitive features (auth, data access, API endpoints):

```bash
@security-reviewer Analyze feature security
```

**Check**:
- Input validation
- SQL injection prevention
- XSS prevention
- Authentication/authorization
- Rate limiting
- Error messages (no sensitive data leakage)

## Phase 7: Documentation

Update CLAUDE.md if feature changes architecture or adds new components.

**Do NOT create** separate .md files unless explicitly requested.

## Phase 8: Commit and Deploy

1. **Run full test suite**:
   ```bash
   cd backend-ts && npm test
   cd ../frontend && npm test
   ```

2. **Commit changes**:
   ```bash
   git add backend-ts/src/*.ts frontend/src/components/*.tsx
   git commit -m "feat: add [feature name]

   - Backend: [changes]
   - Frontend: [changes]
   - Tests: [coverage stats]

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

3. **Full deploy**:
   ```bash
   ./ccplus web
   ```

4. **Verify deployment**: Test feature in production-like environment.

## Checklist

Before marking feature complete:

- [ ] Plan reviewed and approved
- [ ] Database migration tested (if applicable)
- [ ] API endpoints implemented and tested
- [ ] Frontend components implemented and styled
- [ ] WebSocket events wired correctly (if applicable)
- [ ] Backend tests written and passing (80%+ coverage)
- [ ] Frontend tests written and passing
- [ ] Integration testing completed
- [ ] Code review issues addressed
- [ ] Security review passed (if applicable)
- [ ] CLAUDE.md updated (if needed)
- [ ] Changes committed with descriptive message
- [ ] Deployed and verified

## Common Patterns

### Adding a WebSocket Event

1. **Backend**: Emit in `server.ts` or `sdk-session.ts`:
   ```typescript
   io.to(sessionId).emit('feature_event', { data: ... });
   ```

2. **Frontend**: Handle in `useSocket.ts`:
   ```typescript
   socket.on('feature_event', (data) => {
       setFeatureData(data);
   });
   ```

### Adding a Database Table

1. **Migration** in `database.ts`:
   ```typescript
   db.exec(`
       CREATE TABLE features (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           created_at TEXT DEFAULT (datetime('now', 'localtime'))
       );
   `);
   ```

2. **CRUD functions**:
   ```typescript
   export function addFeature(name: string): number { ... }
   export function getFeature(id: number): Feature | null { ... }
   export function updateFeature(id: number, name: string): void { ... }
   export function deleteFeature(id: number): void { ... }
   ```

### Adding API Authentication

Use `authenticateToken` middleware:

```typescript
app.post('/api/feature', authenticateToken, (req, res) => {
    const userId = req.user.userId;  // Available after auth
    // ...
});
```

## Troubleshooting

See `debug-sdk.md` for SDK issues, `troubleshoot-tests.md` for test failures.
