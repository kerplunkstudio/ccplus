---
description: "Playbook for debugging Claude Code SDK connection and query issues"
---

# Debug SDK Workflow

Troubleshooting guide for Claude Code SDK integration issues in cc+.

## Quick Diagnostics

Run system health check first:

```bash
./ccplus doctor
```

This checks:
- Node.js version (requires 18+)
- Environment config (`.env` loaded correctly)
- Services (server running, port available)
- Build status (backend compiled, frontend deployed)
- Database (schema valid, recent activity)

**Green checkmarks**: System healthy. Issue is elsewhere.
**Red X marks**: Fix the indicated problem first.

## Claude CLI Authentication

SDK uses your Claude CLI authentication. Verify:

```bash
claude --version
claude auth status
```

**Expected output**:
```
claude version: 1.x.x
Authenticated as: your.email@example.com
```

**If not authenticated**:
```bash
claude auth login
```

Follow the OAuth flow to authenticate.

**Common issues**:
- **Token expired**: Run `claude auth login` again
- **Wrong subscription**: Verify subscription includes API access
- **CLI not installed**: Install from https://github.com/anthropics/claude-cli

## Server Logs

Check recent logs for SDK errors:

```bash
tail -f logs/server.log
```

**Look for**:
- SDK timeout: `Error: Request timed out`
- Auth errors: `Error: Authentication failed`
- Model unavailable: `Error: Model not available`
- Rate limiting: `Error: Rate limit exceeded`

**Verbose logging**: Set `LOG_LEVEL=debug` in `.env` for detailed SDK traces.

## WebSocket Connection

Test WebSocket connection directly:

```bash
# In browser console (after opening cc+ UI)
socket.emit('ping')
# Wait for 'pong' event in console
```

**Expected**: `Received pong: { timestamp: ... }`

**If no pong**:
1. Check server is running: `curl http://localhost:4000/health`
2. Check WebSocket handshake in Network tab (filter: WS)
3. Check auth token in localStorage: `localStorage.getItem('token')`

## Test SDK Directly

Send a test message via WebSocket:

```javascript
// In browser console
socket.emit('message', { message: 'Hello from test' })
```

**Expected behavior**:
1. `message_received` event
2. Series of `text_delta` events (streaming response)
3. `response_complete` event

**If no response**:
- Check `logs/server.log` for SDK errors
- Check `data/ccplus.db` for recorded messages:
  ```bash
  sqlite3 data/ccplus.db "SELECT * FROM conversations ORDER BY timestamp DESC LIMIT 5;"
  ```

## Common SDK Errors

### Error: SDK Timeout

**Symptom**: Query hangs, no response after 60+ seconds.

**Causes**:
- Network connectivity issues
- SDK service outage
- Rate limiting

**Fix**:
1. Check internet connection
2. Check Anthropic status page
3. Cancel query and retry
4. Increase timeout in `sdk-session.ts` (not recommended)

### Error: Authentication Failed

**Symptom**: `Error: Authentication failed` in logs.

**Fix**:
```bash
claude auth login
./ccplus server  # Restart to pick up new token
```

### Error: Model Not Available

**Symptom**: `Error: Model 'opus' not available` or similar.

**Fix**: Check `SDK_MODEL` in `.env`. Valid values:
- `sonnet` (default, Claude 3.5 Sonnet)
- `opus` (Claude 3 Opus)
- `haiku` (Claude 3 Haiku)

Update `.env` and restart:
```bash
./ccplus server
```

### Error: Rate Limit Exceeded

**Symptom**: `Error: Rate limit exceeded` in logs.

**Fix**: SDK rate limits depend on subscription tier. Wait and retry. Check usage at https://console.anthropic.com.

### Error: Database is Locked

**Symptom**: `Error: database is locked` when recording messages.

**Fix**: SQLite WAL mode should prevent this. If persistent:
```bash
./ccplus stop
sleep 2
./ccplus web
```

## Database Queries for Debugging

Check recent errors:

```bash
sqlite3 data/ccplus.db "SELECT tool_name, error, timestamp FROM tool_usage WHERE error IS NOT NULL ORDER BY timestamp DESC LIMIT 20;"
```

Check tool usage summary:

```bash
sqlite3 data/ccplus.db "SELECT tool_name, COUNT(*) as count, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures FROM tool_usage GROUP BY tool_name ORDER BY count DESC;"
```

Check recent conversations:

```bash
sqlite3 data/ccplus.db "SELECT session_id, role, substr(content, 1, 80), timestamp FROM conversations ORDER BY timestamp DESC LIMIT 20;"
```

Check agent hierarchy for a session:

```bash
# Replace SESSION_ID with actual session_id from conversations table
sqlite3 data/ccplus.db "SELECT tool_name, tool_use_id, parent_agent_id, agent_type, success, duration_ms FROM tool_usage WHERE session_id = 'SESSION_ID' ORDER BY timestamp;"
```

## Verify SDK Installation

Check SDK is installed in backend:

```bash
cd backend-ts
npm list @anthropic-ai/claude-agent-sdk
```

**Expected**: Version number (e.g., `1.0.0`)

**If not found**:
```bash
cd backend-ts && npm install
./ccplus server
```

## Network Debugging

Check API connectivity:

```bash
# Check Claude API endpoint
curl -I https://api.anthropic.com/health
```

**Expected**: `200 OK`

**If timeout or error**: Network issue. Check proxy settings, firewall, VPN.

## Cancellation Not Working

**Symptom**: Cancel button clicked, but query keeps running.

**Expected behavior**: Cancellation is cooperative. SDK checks `interrupt()` flag between messages, not within them. A long-running tool call (e.g., 60-second Bash command) will complete before cancellation is detected.

**Workaround**: None. This is by design. Wait for current tool to complete.

## SDK Session State

Check active SDK sessions:

```bash
curl http://localhost:4000/health | jq '.sessions'
```

**Expected**: Number of active sessions.

**If stuck sessions**: Restart server to clear:
```bash
./ccplus server
```

## Debugging Hooks

SDK hooks (`buildHooks()` in `sdk-session.ts`) can log issues. Check logs for:
- `PreToolUse hook fired` (before tool execution)
- `PostToolUse hook fired` (after tool success)
- `PostToolUseFailure hook fired` (after tool failure)

**If hooks not firing**: Check `buildHooks()` implementation in `sdk-session.ts`.

## Escalation

If issue persists after all checks:

1. **Capture full context**:
   ```bash
   ./ccplus doctor > debug-report.txt
   tail -100 logs/server.log >> debug-report.txt
   sqlite3 data/ccplus.db "SELECT * FROM conversations ORDER BY timestamp DESC LIMIT 10;" >> debug-report.txt
   ```

2. **Minimal reproduction**: Try to reproduce with a simple query like "Hello".

3. **Check GitHub issues**: Search for similar problems at https://github.com/mjfuentes/ccplus/issues

4. **Report issue**: Open new issue with debug report and reproduction steps.
