# Git Workflow

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

## Feature Implementation Workflow

1. **Plan First**
   - Use **planner** agent to create implementation plan
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Use **tdd-guide** agent
   - Write tests first (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Use **code-reviewer** agent immediately after writing code
   - Address CRITICAL and HIGH issues
   - Fix MEDIUM issues when possible

4. **Commit & Push**
   - Detailed commit messages
   - Follow conventional commits format

## PR Merge Policy

### Bug Fixes

All bug fix PRs MUST include:
1. **Symptom**: What the user sees (error message, wrong behavior, crash)
2. **Root cause**: The specific code path and why it fails (file:line reference)
3. **Fix**: Changes that address the root cause (not a workaround)
4. **Regression test**: A test that fails without the fix and passes with it

### Features

Feature PRs MUST include:
- Unit tests for new logic
- Integration test if it adds an API endpoint
- No hardcoded values or secrets

### All PRs

- Backend tests MUST pass: `cd backend-ts && npm test`
- Frontend tests MUST pass: `cd frontend && npm test`
- No console.log statements
- Follow immutable patterns (no object mutation)

## Never Commit

- `.env` (secrets)
- `data/` (runtime database)
- `logs/` (runtime logs)
- `node_modules/` (npm packages)
- `backend-ts/dist/` (compiled TypeScript output)
- `frontend/build/` (build output)
- `static/chat/` (deployed build)
