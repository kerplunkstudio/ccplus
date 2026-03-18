# Architecture

## Message Flow

```
Browser (React)
    |
    | socket.emit("message", { message: "..." })
    v
Socket.IO (server.ts)
    |
    | 1. Record user message to SQLite
    | 2. Emit "message_received" ack
    | 3. Call sdkSession.submitQuery()
    v
Session Manager (sdk-session.ts)
    |
    | Calls query() from @anthropic-ai/claude-agent-sdk
    | Streaming runs in-process (async generator)
    v
Claude Agent SDK
    |
    | async for message in query(prompt, options):
    |   - message.type == "assistant" -> text blocks + tool_use blocks
    |   - message.type == "result"    -> session metadata, cost, tokens
    v
Callbacks (defined in server.ts buildSocketCallbacks)
    |
    | onText(chunk)       -> io.to(sessionId).emit("text_delta", ...)
    | onToolEvent(event) -> io.to(sessionId).emit("tool_event", ...)
    |                       + recordToolEvent() to SQLite
    | onComplete(result)  -> recordMessage() to SQLite
    |                       + io.to(sessionId).emit("response_complete", ...)
    | onError(msg)        -> io.to(sessionId).emit("error", ...)
    v
Browser receives events, updates UI
```

## Async Model

- **Node.js event loop**: Single-threaded async with non-blocking I/O
- **SDK queries**: Run as async generators in the same event loop (in-process)
- **better-sqlite3**: Synchronous database operations, singleton connection, WAL mode for concurrent reads
- **No threading**: All operations execute sequentially in the event loop, async/await for I/O

## Agent Stack (sdk-session.ts)

The SDK's native `agent_id` field is used directly for parent-child correlation in the activity tree. No manual stack management is needed.

**How it works**:
1. The `buildHooks()` function in `sdk-session.ts` returns hook matcher arrays for `PreToolUse`, `PostToolUse`, and `PostToolUseFailure`.
2. Each hook callback receives `agent_id` directly from the SDK hook input (e.g., `hookInput.agent_id`).
3. This `agent_id` identifies the parent agent that spawned the current tool invocation.
4. For root-level tools, `agent_id` is `undefined` and stored as `null` in the database.
5. Nested agents automatically provide their own `tool_use_id` as the `agent_id` for their children.

**Key difference from Python backend**: No manual stack push/pop. The SDK handles parent tracking natively via the `agent_id` field in hook callbacks.

## Activity Tree (Frontend)

The frontend builds a tree from flat `tool_event` WebSocket events using an immutable reducer (`useSocket.ts:treeReducer`).

**Tree construction**:
- `AGENT_START`: Creates an `AgentNode` with empty `children[]`. If `parent_agent_id` is set, inserts under parent via recursive `findAndInsert`. Otherwise appends to root.
- `TOOL_START`: Creates a `ToolNode`. Same parent logic as agents.
- `TOOL_COMPLETE` / `AGENT_STOP`: Finds the node by `tool_use_id` via recursive `findAndUpdate`, updates status/duration/error.
- `CLEAR`: Resets tree (called on each new user message).

**Node types**:
- `AgentNode`: Has `children: ActivityNode[]`, `agent_type`, `description`. Collapsible in UI.
- `ToolNode`: Leaf node with `tool_name`, `parameters`. Not collapsible.

Both have `status: 'running' | 'completed' | 'failed'` and optional `duration_ms`, `error`.

## WebSocket Protocol

### Connection

WebSocket connects to the Socket.IO server with query parameters:
```typescript
io(SOCKET_URL, {
    auth: { token, session_id },
    transports: ['polling', 'websocket'],
});
```

Server validates JWT on `connect` event. Invalid token causes `disconnect()`.

### Client to Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `{ message: string }` | Send user message to Claude Code SDK |
| `cancel` | (none) | Cancel the active SDK query for this session |
| `ping` | (none) | Keepalive ping |

### Server to Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{ session_id }` | Connection confirmed, session joined |
| `message_received` | `{ status: "ok" }` | User message acknowledged |
| `text_delta` | `{ text: string }` | Streaming text chunk from Claude |
| `tool_event` | `ToolEvent` | Tool/agent lifecycle event (see below) |
| `response_complete` | `{ cost, duration_ms, input_tokens, output_tokens }` | SDK query finished |
| `error` | `{ message: string }` | Error during SDK query |
| `cancelled` | `{ status: "ok" }` | Cancellation confirmed |
| `pong` | `{ timestamp: number }` | Keepalive response |

### Tool Event Types

All delivered via the `tool_event` WebSocket event. Differentiated by `type` field:

**`tool_start`**: A tool invocation began.
```json
{
    "type": "tool_start",
    "tool_name": "Bash",
    "tool_use_id": "toolu_abc123",
    "parent_agent_id": "toolu_parent456",
    "parameters": { "command": "pytest tests/" },
    "timestamp": "2025-01-15T10:30:00",
    "session_id": "session_xxx"
}
```

**`tool_complete`**: A tool invocation finished.
```json
{
    "type": "tool_complete",
    "tool_name": "Bash",
    "tool_use_id": "toolu_abc123",
    "parent_agent_id": "toolu_parent456",
    "success": true,
    "error": null,
    "duration_ms": 1234.5,
    "timestamp": "2025-01-15T10:30:01",
    "session_id": "session_xxx"
}
```

**`agent_start`**: An Agent/Task sub-agent spawned.
```json
{
    "type": "agent_start",
    "tool_name": "Agent",
    "tool_use_id": "toolu_agent789",
    "parent_agent_id": null,
    "agent_type": "code_agent",
    "description": "Implement the auth module",
    "timestamp": "2025-01-15T10:30:00",
    "session_id": "session_xxx"
}
```

**`agent_stop`**: An Agent/Task sub-agent completed.
```json
{
    "type": "agent_stop",
    "tool_name": "Agent",
    "tool_use_id": "toolu_agent789",
    "success": true,
    "error": null,
    "duration_ms": 45000,
    "timestamp": "2025-01-15T10:30:45",
    "session_id": "session_xxx"
}
```
