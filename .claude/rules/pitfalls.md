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
