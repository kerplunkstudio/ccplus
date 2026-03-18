# Knowledge Base Protocol

You have access to a persistent knowledge database via MCP tools. USE IT.

## Before Starting ANY Task
Search for existing knowledge so you don't redo work:
```
mcp__memory__memory_search(query="[your topic]")
mcp__memory__memory_search(query="[related topic]")
```
If relevant memories exist, BUILD ON THEM. Don't start from scratch.

## During Your Task
If you discover something valuable (a fact, a pattern, a decision, a lesson), store it immediately:
```
mcp__memory__memory_store(content="[dense, factual content]", metadata={"tags": "tag1,tag2,tag3"})
```

### What to Store
- Facts with numbers, dates, URLs, names
- Decisions made and why
- Lessons learned from mistakes
- Competitor/market data with sources
- Pricing benchmarks with context

### What NOT to Store
- Vague summaries ("various options exist")
- Duplicate info already in the DB
- Session-specific context that won't matter tomorrow

## After Completing Your Task
1. Store 1-3 dense memories with relevant tags
2. Each memory should be independently useful when retrieved by semantic search
3. One fact per sentence. Numbers > adjectives.

## Memory Quality Rules
- Include dates — research without dates is immediately stale
- Include sources (URLs, publication names)
- Tag consistently: topic + type + year (e.g., "pricing,market-research,2026")
- Never store something you can't verify

## Output Format (MANDATORY)
End every task with:
```
## Suggested Next Tasks
- [imperative task name]: [one sentence why]

## Quality Self-Assessment
- confidence: [high/medium/low]
- gaps: [what you couldn't find or verify]

## KB Storage Summary
- hash: [hash from memory_store]
  tags: [tags used]
  description: [one-line]
```
