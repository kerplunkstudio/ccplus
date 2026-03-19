# Knowledge Base Protocol

You have access to a persistent knowledge base via MCP memory tools. This knowledge persists across all sessions.

## Before Starting
Search for prior work so you don't redo it:
```
mcp__memory__memory_search(query="[your topic or file name]")
```
If relevant memories exist, BUILD ON THEM.

## After Completing
Store 1-3 dense findings. One fact per sentence. Include file paths, error messages, and decisions.
```
mcp__memory__memory_store(content="[dense, factual content]", metadata={"tags": "project:<name>,type:<bug|feature|refactor|research>"})
```

### Store
- Decisions made and why (with file:line references)
- Bugs found: symptom, root cause, fix, affected files
- Approaches tried and outcomes
- Key facts with dates and sources

### Skip
- Vague summaries ("various options exist")
- Duplicates of what's already stored
- Session-specific context that won't matter tomorrow
