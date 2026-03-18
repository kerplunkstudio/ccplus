# cc+ Scripts

Utility scripts for cc+ development and operations.

## committer

Safe, scoped git commit helper for agent-driven workflows.

### Purpose

Prevents accidentally staging unrelated files during agent-driven commits. Ensures only specified files are committed, with safety checks for sensitive files and validation of changes.

### Usage

```bash
./scripts/committer "commit message" file1 file2 ...
```

### Example

```bash
./scripts/committer "feat: add search API endpoint" \
    backend-ts/src/database.ts \
    backend-ts/src/server.ts
```

### Features

**Safety checks:**
- Blocks sensitive files (`.env`, `data/`, `logs/`, `node_modules/`, etc.)
- Blocks generated files (`dist/`, `static/chat/`, `frontend/build/`, etc.)
- Validates all files exist
- Validates all files have changes (modified, staged, or untracked)
- Warns if files contain `TODO`, `FIXME`, `HACK`, or `XXX` markers (but allows commit)

**Workflow:**
1. Validates all specified files
2. Shows summary of files to commit
3. Stages ONLY the specified files
4. Creates commit with the provided message
5. Shows commit summary with diff stats

### Exit Codes

- `0` - Success
- `1` - Error (missing args, blocked file, non-existent file, no changes, etc.)

### Blocked Patterns

The following patterns are always blocked:

- `.env` (environment secrets)
- `data/` (runtime SQLite database)
- `logs/` (runtime logs)
- `node_modules/` (npm packages)
- `**/dist/` (compiled output)
- `static/chat/` (deployed frontend)
- `frontend/build/` (frontend build output)
- `*.pyc`, `__pycache__/` (Python compiled files)
- `.DS_Store` (macOS metadata)

### Error Messages

**File does not exist:**
```
Error: File does not exist: path/to/file.ts
```

**Blocked file:**
```
Error: Refusing to commit blocked file: .env (matches pattern: ^\.env$)
```

**File has no changes:**
```
Warning: File has no changes: path/to/file.ts (skipping)
Error: No valid files with changes to commit
```

**Invalid usage:**
```
Error: Usage: ./scripts/committer "commit message" file1 file2 ...
```

## generate_icon.py

Generates app icons for the Electron desktop app in multiple formats (.icns, .png, .ico).

See script comments for usage.
