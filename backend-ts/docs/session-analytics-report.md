# cc+ Session Analytics Report

**Generated**: 2026-03-30
**Database**: `/Users/matifuentes/Workspace/ccplus/data/ccplus.db` (schema v14)
**Data window**: 2026-03-20 – 2026-03-30 (native sessions) + 1,689 imported historical sessions

---

## Executive Summary

cc+ has recorded **178 fleet sessions** in native operation with a **92.7% completion rate** (165 completed, 10 failed, 2 running, 1 cancelled). Sessions run an average of **7.7 minutes** with **56 tool calls** and **1–2 spawned agents** per session. Total native API spend across the tracked window is **$372.54**, averaging **$1.33/session**.

The system is healthy at the macro level, but three bottlenecks stand out: **Bash tool failures are the dominant reliability issue** (6% native fail rate, largest absolute count), **stale worktree paths cause recurring "no longer exists" errors** across multiple agent types, and **rate limiting is active on virtually every session** (428 events across 284 sessions). Addressing these three issues would have the largest immediate impact on session reliability.

---

## 1. Session Overview

### 1.1 Status Distribution

| Status    | Count | Pct    |
|-----------|-------|--------|
| completed | 165   | 92.7%  |
| failed    | 10    | 5.6%   |
| running   | 2     | 1.1%   |
| cancelled | 1     | 0.6%   |
| **Total** | **178** | **100%** |

### 1.2 Sessions Per Day (last 8 days)

```
2026-03-30  ████████████████████████████ 26  (20 completed, 4 failed — day in progress)
2026-03-29  █████████████████████████    25  (25 completed, 0 failed)
2026-03-28  █████████████████████████    25  (19 completed, 5 failed)
2026-03-27  ██                            2  (2 completed)
2026-03-26  ███████████████████          19  (all completed)
2026-03-25  ███████████████████████████  27  (26 completed, 1 failed)
2026-03-24  ███████████████████████████████ 31 (all completed)
2026-03-23  ███████████████████████      23  (all completed)
```

Peak: 31 sessions on 2026-03-24. Daily average: ~23 sessions/day (active days).

### 1.3 Session Type Breakdown (by ID prefix)

| Type        | Count | Failed | Fail% | Avg Tools | Avg Agents | Avg Duration |
|-------------|-------|--------|-------|-----------|------------|--------------|
| fix         | 89    | 6      | 6.7%  | 53.9      | 1.7        | 6.8 min      |
| feat        | 52    | 3      | 5.8%  | 70.9      | 2.0        | 9.2 min      |
| research    | 12    | 1      | 8.3%  | 46.2      | 0.9        | 4.6 min      |
| interactive | 1     | —      | —     | —         | —          | —            |
| cleanup     | 1     | —      | —     | —         | —          | —            |

Feature sessions are the most demanding (+31% more tools, +28% longer than fix sessions). Research sessions are lightweight. All three types have similar failure rates (~6–8%).

### 1.4 Sessions by Request Source

| Source   | Total | Completed | Failed | Avg Tools | Avg Agents | Avg Duration |
|----------|-------|-----------|--------|-----------|------------|--------------|
| web      | 122   | 113       | 6      | 57.8      | 1.3        | 16.5 min     |
| telegram | 32    | 31        | 1      | 66.1      | 3.2        | 8.0 min      |
| fleet    | 21    | 18        | 3      | 53.1      | 2.2        | 7.4 min      |

**Note**: `web` sessions show a much higher average duration (16.5 min) than telegram/fleet, likely because manual web sessions involve larger interactive tasks. Telegram-launched sessions use significantly more agents on average (3.2 vs 1.3).

---

## 2. Session Cost & Token Usage

### 2.1 Token Distribution (completed sessions, fleet_sessions table)

| Quartile | Min Tokens  | Max Tokens  | Avg Tokens  | Sessions |
|----------|-------------|-------------|-------------|----------|
| Q1       | 0           | 172,124     | 65,003      | 42       |
| Q2       | 172,485     | 271,322     | 223,262     | 41       |
| Q3       | 272,486     | 553,583     | 378,881     | 41       |
| Q4       | 572,726     | 3,835,122   | 1,411,019   | 41       |

Overall avg: **516,787 tokens/session** (fleet_sessions). The Q4 tail extends to 3.8M tokens — a 22x spread between Q1 and Q4 indicates high variance in session complexity.

### 2.2 Native API Spend (query_usage, source='native')

| Metric            | Value             |
|-------------------|-------------------|
| Total queries     | 1,724             |
| Total cost        | $372.54           |
| Avg cost/query    | $0.199            |
| Avg cost/session  | $1.33 (completed) |
| Max session cost  | $7.71             |
| Min session cost  | $0.00             |

**Top 5 most expensive native sessions:**

| Session ID                                    | Cost   | Queries |
|-----------------------------------------------|--------|---------|
| refactor-backend-split-large-files            | $7.71  | ~33     |
| session_1774177400251_0wf23eph0               | $5.46  | 33      |
| session_1774100718669_zqw6ce22p               | $5.41  | 33      |
| fix-fleet-dashboard-tool-log-stops-at-128-v2  | $5.32  | —       |
| feat-workflows-panel-interactive-frontend     | $5.32  | —       |

### 2.3 Model Usage (native)

| Model                       | Queries | Cost    | Avg Cost/Query |
|-----------------------------|---------|---------|----------------|
| (unlabeled)                 | 1,548   | $344.27 | $0.222         |
| claude-opus-4-6             | 129     | $21.11  | $0.164         |
| claude-sonnet-4-6           | 45      | $7.12   | $0.158         |
| claude-sonnet-4             | 1       | $0.05   | $0.050         |
| claude-3-5-sonnet-20241022  | 1       | $0.00   | $0.000         |

Most queries (89.8%) have no model label recorded. Of labeled queries, Opus 4.6 is used for ~74% and costs slightly more per query than Sonnet 4.6.

### 2.4 Cache Utilization (native)

| Metric                    | Tokens      |
|---------------------------|-------------|
| Total input tokens        | 31,476      |
| Total output tokens       | 1,234,542   |
| Cache reads               | 141,877,583 |
| Cache creations (labeled) | 15,060,129  |

Cache reads dwarf input tokens by ~4,500x, indicating very high prompt-caching effectiveness. This is the expected pattern for multi-agent workflows where system prompts and context are repeatedly reused.

### 2.5 Daily Cost Trend (native)

```
2026-03-21  ████████████████████████████████  $79.29   299 queries
2026-03-23  ██████████████████████████        $56.13   310 queries
2026-03-24  ████████████████████████          $49.04   224 queries
2026-03-29  █████████████████████████         $51.51   198 queries
2026-03-25  █████████████████                 $34.94   179 queries
2026-03-22  ██████████████████                $38.17   205 queries
2026-03-28  █████████████                     $25.95   155 queries
2026-03-26  █████████                         $17.91    70 queries
2026-03-30  ████████                          $16.18    49 queries (partial)
2026-03-27  ██                                 $3.37    14 queries
```

2026-03-21 was the highest-spend day ($79.29). The pattern shows consistent heavy usage Mon–Sat.

---

## 3. Agent Patterns

### 3.1 Agent Count Distribution

| Agents per Session | Sessions | Avg Tool Count |
|--------------------|----------|----------------|
| 1                  | 16       | 25.6           |
| 2                  | 8        | 32.3           |
| 3                  | 11       | 55.4           |
| 4                  | 26       | 66.4           |
| 5                  | 13       | 103.4          |
| 6                  | 7        | 122.1          |
| 7                  | 3        | 104.7          |
| 11                 | 1        | 75.0           |

Clear correlation: more agents = more tools. Sessions with 5–6 agents average 100+ tool calls. The majority of sessions (85/165 completed) have agent count not recorded in fleet_sessions (likely older records or sessions that didn't spawn sub-agents).

### 3.2 Agent Sub-type Performance

| Agent Type      | Invocations | Successes | Failures | Fail% | Avg Duration |
|-----------------|-------------|-----------|----------|-------|--------------|
| code-reviewer   | 207         | 204       | 3        | 1.4%  | 3.7 min      |
| code_agent      | 199         | 187       | 11       | 5.5%  | 3.0 min      |
| frontend-agent  | 67          | 62        | 5        | 7.5%  | 2.8 min      |
| merge-cleanup   | 56          | 55        | 1        | 1.8%  | 6.0 min      |
| Explore         | 45          | 45        | 0        | 0.0%  | 1.1 min      |
| planner         | 35          | 32        | 3        | 8.6%  | 2.0 min      |
| tdd-guide       | 33          | 32        | 1        | 3.0%  | 3.9 min      |
| debugger        | 23          | 23        | 0        | 0.0%  | 4.2 min      |
| general-purpose | 17          | 14        | 1        | 5.9%  | 4.0 min      |
| security-reviewer | 1         | 1         | 0        | 0.0%  | 4.6 min      |
| architect       | 1           | 1         | 0        | 0.0%  | 2.8 min      |

**Highest-risk agents**: `frontend-agent` (7.5% fail rate), `planner` (8.6%). Code reviewer is the most invoked and most reliable (1.4% failure rate), which is expected since it's a gating step.

**Workhorse**: `code_agent` and `code-reviewer` together account for ~60% of all Agent invocations.

### 3.3 merge-cleanup Success Rate

Sessions where `merge-cleanup` was invoked: 53 total, 44 successful, 8 failed (15.1% session failure rate when merge-cleanup is involved). merge-cleanup agent itself has only 1.8% fail rate — the session failures likely originate upstream (conflicts, failed tests), not in cleanup itself.

### 3.4 Worktree Success Rate

Only 2 sessions used explicit worktree paths in `workspace` — both completed. However, stale worktree paths are a major error pattern in the tool error data (see Section 5).

---

## 4. Captain Chat Patterns

### 4.1 Message Volume

| Metric                  | Value                          |
|-------------------------|--------------------------------|
| Total messages          | 356                            |
| Unique conversations    | 1                              |
| Date range              | 2026-03-29 – 2026-03-30        |
| Messages on 2026-03-29  | 216 (81 user, 135 assistant)   |
| Messages on 2026-03-30  | 140 (41 user, 99 assistant)    |

Note: Captain messages only span 2 days — this table was introduced in migration v14 and is relatively new.

### 4.2 Message Source Breakdown

| Role      | Source   | Count |
|-----------|----------|-------|
| assistant | web      | 234   |
| user      | telegram | 64    |
| user      | fleet    | 42    |
| user      | web      | 16    |

**Key insight**: 84% of user-initiated Captain messages come from non-web sources (Telegram 56%, fleet 37%). This suggests cc+ is heavily used as a background/remote orchestration system, where users prefer Telegram for commands rather than the web UI.

### 4.3 Response Ratio

User messages: 122. Assistant messages: 234. Ratio: ~1.9 assistant messages per user message. This indicates Captain frequently sends multi-part responses or updates.

---

## 5. Tool Usage Patterns

### 5.1 Tool Frequency Ranking (all sources)

| Rank | Tool                              | Total Uses | Avg Duration |
|------|-----------------------------------|------------|--------------|
| 1    | Bash                              | 17,123     | 2,894 ms     |
| 2    | Read                              | 10,909     | 112 ms       |
| 3    | Edit                              | 4,342      | 74 ms        |
| 4    | Grep                              | 3,610      | 52 ms        |
| 5    | Agent                             | 3,138      | 202,171 ms   |
| 6    | Glob                              | 1,261      | 513 ms       |
| 7    | Write                             | 658        | 87 ms        |
| 8    | ToolSearch                        | 350        | 35 ms        |
| 9    | WebFetch                          | 320        | 6,275 ms     |
| 10   | WebSearch                         | 305        | 8,265 ms     |
| 11   | mcp__fleet-control__start_session | 218        | —            |
| 12   | Skill                             | 174        | 49 ms        |
| 13   | TaskUpdate                        | 153        | —            |
| 14   | mcp__memory__memory_store         | 133        | —            |
| 15   | AskUserQuestion                   | 121        | —            |

Bash dominates at 40% of all tool calls. The Agent tool has by far the highest per-call duration (~3.4 min average), reflecting sub-agent lifecycle cost.

### 5.2 Tool Failure Rates (native sessions only)

| Tool                      | Uses   | Failures | Fail%  |
|---------------------------|--------|----------|--------|
| mcp__Code_Assist__git_*   | 3      | 3        | 100%   |
| Bash                      | 7,253  | 1,022    | 14.1%  |
| WebFetch                  | 128    | 13       | 10.2%  |
| Read                      | 4,493  | 261      | 5.8%   |
| Write                     | 312    | 15       | 4.8%   |
| Agent                     | 694    | 25       | 3.6%   |
| Edit                      | 1,824  | 53       | 2.9%   |
| Glob                      | 474    | 2        | 0.4%   |
| Grep / WebSearch / Skill  | —      | 0        | 0.0%   |

**Overall tool failure rate: 3.16%** (1,393 failures / 44,036 recorded uses).

### 5.3 Bash Failure Breakdown (native)

| Error Category                       | Count |
|--------------------------------------|-------|
| Exit code 1 (generic)                | 608   |
| Stale worktree "no longer exists"    | 304   |
| Server restarted                     | 55    |
| Exit code 128 (git errors)           | 52    |
| Exit code 127 (command not found)    | 127   |

**Stale worktrees account for 29.8% of all Bash failures**. Another 12.4% come from `tsc` or `node_modules` not found (exit 127), indicating agents sometimes run TypeScript compilation without first installing dependencies.

**Top worktree names with stale path errors** (by occurrence):
- precious-swimming-conway: 17
- crispy-sleeping-forest: 16
- reactive-tickling-reef: 14
- rippling-questing-jellyfish: 11
- abundant-bouncing-meteor: 10

These errors occur because git worktrees are deleted but in-flight agents still reference them.

### 5.4 Read Tool Failures (native)

| Error Type                            | Count |
|---------------------------------------|-------|
| File does not exist (stale worktree)  | ~50+  |
| File content exceeds token limit      | 12    |
| Other path errors                     | ~200  |

File-not-found in stale worktree paths is the primary Read failure cause. Token overflow (>10,000 tokens) accounts for 12 failures — agents attempting to read large files without pagination.

---

## 6. Rate Limiting

### 6.1 Overview

| Metric                    | Value  |
|---------------------------|--------|
| Total rate limit events   | 428    |
| Sessions affected         | 284    |
| Avg retry_after_ms        | 0 ms   |

**Note**: `retry_after_ms` is recorded as 0 for all events, suggesting the retry-after header is not being parsed or stored correctly.

### 6.2 Rate Limit Events Per Day

```
2026-03-21  ████████████████████████████████████████████████████████████████████████████████████  87
2026-03-29  ████████████████████████████████████████████████████████████████████████████████████  87
2026-03-23  ██████████████████████████████████████████████████████████████████████               70
2026-03-22  ████████████████████████████████████████████████                                     48
2026-03-24  ██████████████████████████████████████                                               38
2026-03-25  ████████████████████████████                                                         28
2026-03-28  ███████████████████████████                                                          27
2026-03-26  ████████████████                                                                     16
2026-03-30  ██████████████████████                                                               22
2026-03-27  ██                                                                                    2
```

Rate limiting is worst on high-volume days. 284 / 165 = **1.7 rate limit events per completed session on average**, meaning virtually every session hits the API rate limit at least once.

### 6.3 Most Rate-Limited Sessions

| Session                                      | RL Hits |
|----------------------------------------------|---------|
| session_1774177400251_0wf23eph0              | 13      |
| fix-fleet-dashboard-cancelled-sessions-invisible | 8   |
| feat-activity-tree-orchestrator-agent-node   | 8      |
| session_1774279968441_9xubotsl4              | 7      |
| session_1774100718669_zqw6ce22p              | 7      |

---

## 7. Memory Distillations

| Metric               | Value  |
|----------------------|--------|
| Total distillations  | 255    |
| Successes            | 254    |
| Failures             | 1      |
| Avg memories/run     | 84.1   |
| Success rate         | 99.6%  |

| Trigger              | Count | Successes | Avg Memories | Avg Duration |
|----------------------|-------|-----------|--------------|--------------|
| system-prompt-injection | 236 | 235     | 90.6         | 1,743 ms     |
| post-completion      | 19    | 19        | 3.6          | 367 ms       |

Memory distillation is extremely reliable (99.6% success). The `system-prompt-injection` trigger fires ~12x more often than `post-completion` and produces ~25x more memories per run, suggesting it's the primary distillation pathway (likely triggered on each session start).

---

## 8. Imported Session Data

| Metric              | Value     |
|---------------------|-----------|
| Imported sessions   | 1,689     |
| Total messages      | 55,819    |
| Total queries       | 49,212    |
| Total tool calls    | 26,379    |
| Total spend         | $10,237.92 |

Imported sessions represent a much larger historical corpus than native sessions. Top single imported session cost: **$1,263.23** (2,205 queries). This historical data is available for trend analysis but is not included in the native metrics above unless noted.

---

## 9. Identified Bottlenecks

### Bottleneck 1: Stale Worktree Paths (HIGH IMPACT)

**Symptom**: 304 Bash errors + ~50+ Read errors from worktrees that no longer exist.
**Root cause**: Git worktrees are deleted while in-flight agents still hold references to them. The `Bash` tool reports "Working directory does not exist" but agents continue attempting operations.
**Impact**: ~30% of all Bash failures in native sessions. Creates orphaned tool_usage rows with `error='Server restarted'`.

### Bottleneck 2: Rate Limiting (HIGH IMPACT)

**Symptom**: 428 rate limit events across 284 sessions (~1.7 per session average).
**Root cause**: `retry_after_ms` is stored as 0 for all events, suggesting the SDK's rate-limit response isn't being correctly parsed or the backoff is not being applied.
**Impact**: Every high-volume session is affected. Peak days (87 events) suggest the API is being hit in burst patterns.

### Bottleneck 3: Bash Exit 127 — Missing `tsc` / Node deps (MEDIUM IMPACT)

**Symptom**: 127 native Bash failures with "command not found: tsc" or "no such file: node_modules/.bin/tsc".
**Root cause**: Agents run `npm run build` or `tsc` directly without first running `npm install` in the worktree directory. Each worktree is a fresh checkout.
**Impact**: Build verification steps fail silently or require retry, adding latency to every affected session.

### Bottleneck 4: Frontend-Agent and Planner Failure Rates (MEDIUM IMPACT)

**Symptom**: `frontend-agent` 7.5% fail rate, `planner` 8.6% — highest among named agents.
**Root cause**: Not directly observable from this data, but likely relates to context window pressure (frontend-agent works with many component files) or worktree path issues.
**Impact**: 1 in 13 frontend-agent invocations and 1 in 12 planner invocations fails.

### Bottleneck 5: Long-Tail Session Duration Outliers (LOW-MEDIUM IMPACT)

**Symptom**: Session duration ranges from 0.56 min to 29.5 min (53x spread). One failed session shows 862 min.
**Root cause**: `fix-captain-cold-start-latency` ran for 862 minutes before failing — likely a stuck or abandoned session.
**Impact**: Long-running sessions may tie up fleet slots and inflate average duration metrics.

### Bottleneck 6: No Trust Score Table

**Symptom**: `user_stats` contains only 1 row (`local` user). There is no dedicated trust-score table; trust computation happens in `trust-score.ts` using `tool_usage` + `query_usage` + `conversations` at query time.
**Impact**: Trust scores are not persisted, so historical trust drift cannot be analyzed directly from the DB. Analysis requires re-computing from raw data.

---

## 10. Recommendations

### 10.1 Fix Stale Worktree Detection [Critical]

Add a pre-flight check in `sdk-session.ts` (or the fleet monitor) that verifies the worktree directory exists before launching a session. If the directory is gone, fail fast with a clear error rather than allowing dozens of tool calls to fail. Consider storing a `worktree_valid` flag in `fleet_sessions`.

```sql
-- Query to detect sessions with high stale-worktree errors:
SELECT session_id, COUNT(*) as errors
FROM tool_usage
WHERE error LIKE '%no longer exists%'
GROUP BY session_id
HAVING errors > 3;
```

### 10.2 Fix retry_after_ms Recording [High]

`retry_after_ms` is 0 for all 428 rate limit events. The `rate_limit_events` table schema expects a non-null integer. Verify that the SDK's rate-limit hook correctly extracts `retry_after` from the response header and passes it to `recordRateLimitEvent()`. Without accurate values, the adaptive backoff cannot function.

### 10.3 Enforce `npm install` Before Build in Worktrees [High]

In the workflow/agent instructions for any session that runs in a new worktree, mandate `npm install` as the first Bash step before any `tsc`, `npm run build`, or `npm test`. The 127 "command not found" errors would drop to near zero. Consider adding a script to `ccplus` that auto-installs dependencies when entering a worktree.

### 10.4 Add Session Timeout + Stuck Detection [Medium]

Migration v15 adds `stuck_detected_at` to `fleet_sessions` but it's not yet in the deployed DB. Once deployed, use this to: (a) surface stuck sessions in the fleet dashboard, and (b) auto-cancel sessions exceeding a configurable timeout (e.g., 60 minutes). The 862-minute failure session would have been caught much earlier.

### 10.5 Persist Trust Scores [Medium]

Add a `trust_scores` table that stores computed trust scores per session at completion time. This enables historical trend analysis (is trust improving over time?) and correlation with failure rates. A minimal schema:

```sql
CREATE TABLE trust_scores (
  session_id TEXT PRIMARY KEY,
  score REAL NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  risk_level TEXT NOT NULL
);
```

### 10.6 Record Model Label on All Queries [Low]

89.8% of native `query_usage` rows have NULL model. Ensure the SDK completion hook always records the model name. This is needed to accurately track Opus vs Sonnet usage and cost per model.

### 10.7 Investigate High Telegram Agent Count [Low]

Telegram-launched sessions use 2.5x more agents on average (3.2 vs 1.3 for web). Determine whether this is intentional (Telegram triggers orchestrated multi-agent workflows) or a misconfiguration causing redundant agent spawning.

---

## Appendix: Schema Notes

- `stuck_detected_at` column (migration v15) is not yet in the deployed database (current schema: v14). Stuck session analysis is therefore not available.
- `label` column in `fleet_sessions` is empty for all 178 rows — session identity is carried by `session_id` slug instead.
- Trust scoring is not a persisted DB column; `backend-ts/src/trust-score.ts` computes it on demand from `tool_usage`, `query_usage`, and `conversations` tables.
- The `workflows` table contains 5 builtin workflows: `bug-fix`, `default`, `feature`, `security-audit`, `tdd`. No custom workflows have been created yet.
