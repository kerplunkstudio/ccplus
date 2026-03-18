---
description: "Playbook for troubleshooting test failures in cc+ backend (Vitest) and frontend (Jest)"
---

# Troubleshoot Tests Workflow

Debugging guide for test failures in cc+.

## Quick Test Commands

**Backend (Vitest)**:
```bash
cd backend-ts && npm test                              # Run all tests
cd backend-ts && npx vitest run src/__tests__/auth.test.ts   # Run specific file
cd backend-ts && npm run test:coverage                 # Coverage report
```

**Frontend (Jest + React Testing Library)**:
```bash
cd frontend && npm test                                # Run all tests (watch mode)
cd frontend && npm test -- --watchAll=false            # Run once, exit
cd frontend && npm test -- FeaturePanel                # Run specific file
```

## Common Backend Test Issues

### Database State Leaks

**Symptom**: Tests pass individually, fail when run together.

**Cause**: Tests sharing database state. One test's data affects another.

**Fix**: Use in-memory database, reset before each test:

```typescript
import { beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../database.js';

describe('Feature Tests', () => {
    beforeEach(() => {
        initDatabase(':memory:');  // Fresh database for each test
    });

    // Tests...
});
```

**Verify isolation**: Run tests in random order:
```bash
cd backend-ts && npx vitest run --sequence.shuffle
```

### Mock Setup Issues

**Symptom**: `TypeError: Cannot read property 'mockReturnValue' of undefined`

**Cause**: Mock not properly initialized before use.

**Fix**: Setup mocks in `beforeEach`:

```typescript
import { vi, beforeEach } from 'vitest';

vi.mock('../sdk-session.js', () => ({
    submitQuery: vi.fn(),
}));

describe('Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();  // Clear mock history between tests
    });

    it('should call mocked function', () => {
        // Mock implementation if needed
        const { submitQuery } = await import('../sdk-session.js');
        submitQuery.mockResolvedValue({ success: true });

        // Test code...
    });
});
```

### Async Timing Issues

**Symptom**: Test fails with "expected X but got undefined", inconsistent failures.

**Cause**: Test assertion runs before async operation completes.

**Fix**: Use `await` for async operations, `waitFor` for React updates:

```typescript
import { waitFor } from '@testing-library/react';

it('should update state', async () => {
    const result = await asyncFunction();
    expect(result).toBeDefined();
});

it('should render async data', async () => {
    render(<Component />);
    await waitFor(() => {
        expect(screen.getByText('Loaded Data')).toBeInTheDocument();
    });
});
```

### Vitest Import Errors

**Symptom**: `Error: Cannot find module '../database.js'`

**Cause**: Vitest uses ESM, needs `.js` extension even for `.ts` files.

**Fix**: Always use `.js` extension in imports within tests:

```typescript
// CORRECT:
import { addUser } from '../database.js';

// WRONG:
import { addUser } from '../database.ts';
import { addUser } from '../database';
```

### Environment Variables Not Loaded

**Symptom**: `process.env.WORKSPACE_PATH` is undefined in tests.

**Cause**: `.env` not loaded in test environment.

**Fix**: Use `setupFiles` in `vitest.config.ts`:

```typescript
export default defineConfig({
    test: {
        setupFiles: ['./src/__tests__/setup.ts'],
    },
});
```

In `setup.ts`:
```typescript
import { config } from 'dotenv';
config();
```

## Common Frontend Test Issues

### Component Not Rendering

**Symptom**: `TestingLibraryElementError: Unable to find element`

**Cause**: Component not rendered or selector incorrect.

**Fix**: Check component renders and use correct query:

```typescript
import { render, screen } from '@testing-library/react';

it('should render component', () => {
    render(<Component />);

    // Debug: see what's rendered
    screen.debug();

    // Use accessible queries (preferred order):
    screen.getByRole('button', { name: 'Submit' });
    screen.getByLabelText('Email');
    screen.getByText('Hello');
    screen.getByTestId('custom-element');  // Last resort
});
```

### Mock WebSocket Not Working

**Symptom**: Tests timeout waiting for WebSocket events.

**Cause**: WebSocket not mocked, trying to connect to real server.

**Fix**: Mock `socket.io-client`:

```typescript
import { vi } from 'vitest';

const mockSocket = {
    on: vi.fn(),
    emit: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => mockSocket),
}));

describe('Tests', () => {
    it('should handle socket event', () => {
        render(<Component />);

        // Simulate socket event
        const onCallback = mockSocket.on.mock.calls.find(
            call => call[0] === 'message'
        )[1];
        onCallback({ text: 'Hello' });

        expect(screen.getByText('Hello')).toBeInTheDocument();
    });
});
```

### React Hook Errors

**Symptom**: `Error: Invalid hook call. Hooks can only be called inside body of function component`

**Cause**: Testing hook outside React component context.

**Fix**: Use `renderHook` from `@testing-library/react`:

```typescript
import { renderHook, act } from '@testing-library/react';

it('should update state', () => {
    const { result } = renderHook(() => useCustomHook());

    act(() => {
        result.current.updateValue('new');
    });

    expect(result.current.value).toBe('new');
});
```

### CSS Import Errors

**Symptom**: `SyntaxError: Unexpected token '.'` when importing CSS.

**Cause**: Jest doesn't know how to handle CSS imports.

**Fix**: Mock CSS modules in `jest.config.js`:

```javascript
module.exports = {
    moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    },
};
```

## Coverage Issues

### Low Coverage Warnings

**Symptom**: `Coverage threshold not met` or specific lines uncovered.

**Fix**: Identify uncovered code:

```bash
cd backend-ts && npm run test:coverage
# Open coverage/index.html in browser
```

**Add tests for**:
- Error paths (try/catch blocks)
- Edge cases (null, undefined, empty, max values)
- Conditional branches (if/else)

**Example**:
```typescript
// Function to test
function divide(a: number, b: number): number {
    if (b === 0) throw new Error('Division by zero');  // Error path
    return a / b;
}

// Tests
it('should divide numbers', () => {
    expect(divide(10, 2)).toBe(5);
});

it('should throw on division by zero', () => {
    expect(() => divide(10, 0)).toThrow('Division by zero');  // Test error path
});
```

### False Coverage

**Symptom**: 100% coverage but bugs still exist.

**Cause**: Tests pass but don't verify correct behavior.

**Fix**: Add assertion coverage:

```typescript
// BAD: Function runs but no assertion
it('should process data', () => {
    processData(input);  // No assertion!
});

// GOOD: Verify behavior
it('should process data', () => {
    const result = processData(input);
    expect(result.status).toBe('success');
    expect(result.data).toHaveLength(3);
});
```

## Debugging Strategies

### Run Single Test

Isolate failing test:

```bash
# Backend
cd backend-ts && npx vitest run -t "specific test name"

# Frontend
cd frontend && npm test -- -t "specific test name"
```

### Add Debug Output

```typescript
it('should do something', () => {
    const result = functionUnderTest();

    // Debug: inspect actual value
    console.log('Result:', JSON.stringify(result, null, 2));

    expect(result).toEqual(expected);
});
```

### Use Debugger

**Backend (Vitest)**:
```typescript
it('should debug', () => {
    debugger;  // Will pause if running with --inspect
    const result = functionUnderTest();
    expect(result).toBe(expected);
});
```

Run with inspector:
```bash
cd backend-ts && node --inspect-brk ./node_modules/vitest/vitest.mjs run
```

**Frontend (Jest)**:
```bash
cd frontend && node --inspect-brk node_modules/.bin/jest --runInBand
```

Then attach debugger in VS Code or Chrome DevTools.

### Check Test Dependencies

Verify all test dependencies installed:

```bash
cd backend-ts && npm install
cd ../frontend && npm install
```

## Test Structure Best Practices

### Arrange-Act-Assert Pattern

```typescript
it('should update user', () => {
    // Arrange: Setup test data
    const user = { id: 1, name: 'Alice' };

    // Act: Perform action
    const updated = updateUser(user, { name: 'Bob' });

    // Assert: Verify result
    expect(updated.name).toBe('Bob');
    expect(updated.id).toBe(1);
});
```

### Descriptive Test Names

```typescript
// BAD: Vague
it('should work', () => { ... });

// GOOD: Specific
it('should return null when user not found', () => { ... });
it('should throw error when email is invalid', () => { ... });
it('should update user name while preserving other fields', () => { ... });
```

### One Assertion Per Test (guideline, not rule)

```typescript
// Prefer separate tests for distinct behaviors
it('should create user with valid data', () => {
    const user = createUser({ name: 'Alice', email: 'alice@example.com' });
    expect(user.id).toBeDefined();
});

it('should throw when email is invalid', () => {
    expect(() => createUser({ name: 'Alice', email: 'invalid' }))
        .toThrow('Invalid email');
});
```

## Performance Issues

### Slow Tests

**Symptom**: Test suite takes >10 seconds.

**Fix**:
1. **Parallelize**: Vitest runs in parallel by default. Jest needs `--maxWorkers=4`.
2. **Reduce setup**: Only create test data needed for each test.
3. **Mock heavy operations**: Don't make real network calls or file I/O.
4. **Use in-memory database**: Faster than disk-based SQLite.

```bash
# Run with specific worker count
cd backend-ts && npx vitest run --threads --maxThreads=4
cd frontend && npm test -- --maxWorkers=4
```

### Test Timeouts

**Symptom**: `Test timeout: exceeded 5000ms`

**Cause**: Async operation not completing or not awaited.

**Fix**: Increase timeout or fix async handling:

```typescript
it('should handle slow operation', async () => {
    // Increase timeout for this test
    vi.setConfig({ testTimeout: 10000 });

    const result = await slowAsyncFunction();
    expect(result).toBeDefined();
}, 10000);  // Or set timeout here
```

## Test Utilities

### Shared Test Fixtures

Create reusable test data:

```typescript
// backend-ts/src/__tests__/fixtures.ts
export const mockUser = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
};

export const mockSession = {
    session_id: 'session_test',
    user_id: 'local',
};

// In tests:
import { mockUser, mockSession } from './fixtures';
```

### Custom Matchers

Extend Jest/Vitest matchers:

```typescript
// For comparing dates with tolerance
expect.extend({
    toBeRecentDate(received: string) {
        const date = new Date(received);
        const now = new Date();
        const diff = Math.abs(now.getTime() - date.getTime());
        const pass = diff < 1000;  // Within 1 second

        return {
            pass,
            message: () => `Expected ${received} to be a recent date`,
        };
    },
});

// Usage:
expect(record.timestamp).toBeRecentDate();
```

## When Tests Still Fail

1. **Clean install dependencies**:
   ```bash
   cd backend-ts && rm -rf node_modules package-lock.json && npm install
   cd ../frontend && rm -rf node_modules package-lock.json && npm install
   ```

2. **Clear test cache**:
   ```bash
   cd backend-ts && npx vitest run --clearCache
   cd frontend && npm test -- --clearCache
   ```

3. **Check Node version**: Requires Node 18+
   ```bash
   node --version
   ```

4. **Review recent changes**: Use git to identify what changed:
   ```bash
   git diff HEAD~1 backend-ts/src/
   ```

5. **Isolate the problem**: Comment out code until tests pass, narrow down issue.

6. **Ask for help**: Use `@tdd-guide` agent for test-specific issues.
