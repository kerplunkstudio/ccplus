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

## 13. Merge phase deadlock when code review finds issues

**Problem**: The merge phase blocks Edit and Write tools (git-only operations). If code review finds a BLOCK issue that requires code changes, the agent cannot fix the code or proceed with the merge, creating a deadlock.

**Fix**: If you are in merge phase and code review reports issues requiring code fixes:
1. Transition back to execute phase (`merge -> execute` is a valid transition)
2. Fix the issues in execute phase
3. Run code review again
4. Transition through review -> merge once review passes

Do NOT attempt to fix code using only Bash (e.g., `sed` commands) to work around the Edit block. The proper path is always: transition back to execute.

## 14. Worktree CWD failures must be caught immediately

**Problem**: When a worktree is deleted mid-session, every subsequent Bash call fails with "Working directory no longer exists." Agents have been observed retrying up to 9 times despite the 2-retry limit in pitfall 9, wasting all remaining tool budget.

**Fix**: This is a hard rule, not a guideline. After the FIRST "Working directory no longer exists" error:
1. IMMEDIATELY switch all paths to the main repo: `/Users/matifuentes/Workspace/ccplus/`
2. Do NOT retry any command targeting the deleted worktree path
3. If the task requires worktree-specific uncommitted changes, they are lost -- report to orchestrator and stop
4. If the work was already committed, continue from the main repo using absolute paths

The 2-retry limit from pitfall 9 is the MAXIMUM. Prefer 0 retries -- switch immediately on first CWD failure.

## 15. Concurrent sessions modifying the same shared module

**Problem**: Two sessions modify the same file (e.g., config.ts) concurrently. One session's changes get overwritten or reverted by the other's merge. The fix is correct when written but broken after the other session merges. Real example: a bug-fix session added a `getBypassPermissions()` getter to `config.ts`, but a concurrent refactor session removed all getters from config.ts during a settings migration. The fix was effectively undone.

**Fix**: Before starting a session that modifies shared modules (config.ts, database.ts, server.ts, captain.ts, sdk-session.ts), check for active sessions touching the same files:
1. Captain should call `list_sessions` and compare `files_touched` before launching
2. If overlap detected: wait for the other session to complete, or include the concurrent changes in the session prompt
3. After merge, verify the fix is still present by checking the committed diff on main
