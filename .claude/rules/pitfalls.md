# Common Pitfalls

Known gotchas in the cc+ codebase and how to avoid them.

## 1. Forgetting to deploy frontend changes

**Problem**: You edit `frontend/src/*.tsx` but the browser shows old code.

**Why**: Express serves from `static/chat/`, not from source.

**Fix**: Run `./ccplus frontend` after frontend changes. Hard refresh browser (Cmd+Shift+R).

## 2. better-sqlite3 is synchronous

**Problem**: Database queries block the Node.js event loop.

**Fix**: Accept this. SQLite queries are fast (< 1ms). If you hit performance issues, investigate first before changing the database library.

## 3. Agent parent correlation

**Problem**: Activity tree shows tools under the wrong parent.

**Fix**: Use SDK's native `agent_id` for parent-child correlation. Do NOT implement manual stack management. The SDK handles this. If you see incorrect parent relationships, check `agent_id` values in hook callbacks (logged in `buildHooks()` in `sdk-session.ts`).

## 4. Cancellation is cooperative

**Problem**: Cancelling a query does not kill it instantly.

**Fix**: Accept this. The SDK's `query.interrupt()` is checked between messages, not within them. A long-running tool call will finish before cancellation is detected. The SDK does not support mid-tool cancellation.

## 5. Socket.IO room vs sid

**Problem**: Events not reaching the client, or reaching wrong clients.

**Fix**: Ensure `socket.join(sessionId)` happens on connect. Use `io.to(sessionId).emit(...)` in callbacks to target the correct room. The `sessionId` is the browser session, NOT the Socket.IO `socket.id`.

## 6. Large parameter serialization

**Problem**: Memory bloat from tool parameters containing entire file contents.

**Fix**: Use `safeParams()` in `sdk-session.ts` to truncate string values longer than 200 characters and strip internal keys like `tool_use_id`.

## 7. Dynamic and static imports for the same module

**Problem**: Bundle or runtime errors from mixing import styles.

**Fix**: Pick one style per module. Use static `import` for modules always needed. Use dynamic `await import()` only for optional or lazy-loaded modules. Never mix both for the same package.

## 8. Conflict markers committed after merge or cherry-pick

**Problem**: Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) survive merge resolution and get committed to source files. TypeScript may still compile if markers land inside strings or comments, masking the problem.

**Fix**: After ANY merge or cherry-pick, run both checks before committing:
1. `grep -rn '<<<<<<< \|======= \|>>>>>>> ' --include='*.ts' --include='*.tsx' backend-ts/ frontend/`
2. `cd backend-ts && npx tsc --noEmit`

If grep finds any matches, the merge resolution is incomplete — do not commit. If tsc fails, check whether cherry-pick introduced a type error. Both checks are required; passing one does not guarantee the other.

## 9. Worktree CWD invalidation during session

**Problem**: Another process (server restart, cleanup, or concurrent agent) removes a git worktree while a session is actively using it. Every subsequent Bash and Read call fails with "Working directory no longer exists."

**Fix**: If you see "Working directory no longer exists" errors:
1. STOP retrying the same command — it will never succeed from the deleted path.
2. Switch to the main repo root using absolute paths: `/Users/matifuentes/Workspace/ccplus/`.
3. If the worktree contained uncommitted work, it is lost. Report this to the orchestrator immediately.
4. If you need to continue the task, work from the main repo or request a new worktree.

Do NOT loop on the broken path hoping it recovers. After 2 consecutive CWD failures, pivot to the main repo.

## 10. Worktree branch behind main

**Problem**: A worktree was created from an older commit and the task references files or features that only exist on the latest `main`. The agent wastes many calls discovering files don't exist.

**Fix**: At the start of any worktree session, check how far behind you are:
```bash
git log --oneline main..HEAD | wc -l   # commits ahead
git log --oneline HEAD..main | wc -l   # commits behind
```
If behind by more than 5 commits and the task references recent files, merge main first:
```bash
git merge main --no-edit
```
Do this BEFORE attempting to read or edit files referenced in the task.

## 11. npm install missing in worktrees

**Problem**: Worktrees share git state but NOT `node_modules/`. Running `tsc`, `npm test`, or `npm run build` fails with "module not found" or "command not found" errors.

**Fix**: Before running ANY build or test command in a worktree, check if node_modules exists:
```bash
ls node_modules/.package-lock.json 2>/dev/null || npm install
```
Run this in both `backend-ts/` and `frontend/` if needed. If `npm install` fails (ERESOLVE), use `npm install --legacy-peer-deps`.

## 12. Read tool token limit on large files

**Problem**: The Read tool rejects files exceeding 10,000 tokens with "File content exceeds maximum allowed tokens." Repeated attempts without offset/limit waste tool calls.

**Fix**: If a file is too large to read at once, NEVER retry the same Read without parameters. Instead:
1. Use `offset` and `limit` to read specific sections (e.g., `offset: 1, limit: 200`)
2. Use Grep to find the specific lines you need, then Read with a targeted range
3. For files over ~400 lines, always start with Grep or a targeted Read range
