---
name: merge-cleanup
description: Commits worktree changes, cherry-picks them to main, removes the worktree, and prunes the branch. Use at the end of a session to clean up.
tools: ["Bash", "Read", "Grep", "Glob", "Edit", "Write"]
model: sonnet
---

# merge-cleanup

You commit worktree changes to the current branch, cherry-pick them to main, remove the worktree, and prune the branch. You run once at the end of a session.

## Steps

1. **Check for uncommitted changes**
   - Run `git status --porcelain`
   - If dirty: stage all changes with `git add -A` and commit with a conventional commit message summarizing the work done
   - If clean: skip

2. **Find changes not on main**
   - Run `git diff main..HEAD --stat` to check for actual code differences
   - If the diff is empty (no output): nothing to cherry-pick, skip to cleanup
   - If the diff shows changed files: proceed to cherry-pick
   - NEVER use `git log` or commit messages to decide if changes are already on main — a commit with a similar message does NOT mean the same code was applied. Only `git diff` is authoritative.

3. **Cherry-pick to main via temp worktree**
   - `main` is always checked out in the parent worktree. NEVER run `git checkout main` — it will fail.
   - Instead, create a temp worktree:
     ```bash
     MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}')
     git worktree add /tmp/ccplus-merge-work main --force
     ```
   - Collect the commit SHAs to cherry-pick (oldest first):
     ```bash
     git log --reverse --oneline main..HEAD --format='%H'
     ```
   - Cherry-pick from the temp worktree:
     ```bash
     cd /tmp/ccplus-merge-work && git cherry-pick <sha1> <sha2> ...
     ```
   - If a conflict occurs:
     * Run `git diff --name-only --diff-filter=U` to list conflicting files
     * For each conflicting file: read the file content (it will have `<<<<<<<`, `=======`, `>>>>>>>` conflict markers)
     * Resolve the conflict by keeping both changes: remove the conflict markers and merge both sides intelligently
     * Stage resolved files with `git add <file>`
     * Continue with `git cherry-pick --continue`
     * Only if resolution fails or produces broken code: abort with `git cherry-pick --abort` and report
   - On success: report which commits were cherry-picked

3.5. **Verify commits landed on main**
   - While still in the temp worktree (`/tmp/ccplus-merge-work`), run `git log --oneline -5`
   - For each commit that was cherry-picked, verify its message appears in the log
   - If ANY cherry-picked commit is missing from main's log: STOP and report failure. Do NOT proceed to worktree removal.

4. **Report success** (BEFORE removing any worktrees)
   - Output a summary of what was committed, cherry-picked, and is ready for cleanup
   - Include the worktree path and branch name you are about to delete

5. **Cleanup: remove temp worktree, then session worktree and branch**

   CRITICAL: You MUST `cd` to the main repo root BEFORE removing anything. The order matters:

   ```bash
   # Step 5a: cd to main repo FIRST, then remove the temp worktree
   cd <main_repo_root> && git worktree remove /tmp/ccplus-merge-work --force
   ```

   ```bash
   # Step 5b: remove the session worktree and delete the branch (LAST command)
   git worktree remove <session_worktree_path> --force && git branch -D <branch_name>
   ```

   - CRITICAL: Step 5b must be the LAST Bash call you make. After it, the worktree directory is gone and your session CWD is permanently invalid. The Bash tool checks CWD before executing — even commands starting with `cd /other/path && ...` will fail with "Working directory no longer exists." There is NO workaround. Do NOT retry, do NOT try alternative approaches (bash -c, env -i, --git-dir, etc.) — they ALL fail. Just output your final summary and stop.
   - If step 5a succeeds but 5b fails: the merge succeeded (verified in step 3.5), so this is a non-critical cleanup failure. Report it and stop.

## Common Failure Modes

### CWD invalidation
If you see "Working directory no longer exists": STOP immediately. Do not retry. Output your summary and end. The merge already succeeded if step 3.5 passed.

### Branch deletion fails after worktree removal
This happens when the worktree removal invalidates CWD before `git branch -D` runs. That's why step 5b combines both in one `&&` chain starting from a valid CWD. If it still fails, the branch is orphaned but harmless — report it and move on.

### `git checkout main` fails
Never use `git checkout main`. Always use a temp worktree. The parent worktree has `main` checked out.

## Rules

- NEVER force-push or run `git push --force`
- NEVER modify git history on main (no rebase, no amend)
- NEVER run `git checkout main` — use a temp worktree instead
- If cherry-pick conflicts occur: resolve by reading the conflict markers and merging both sides
- If worktree remove fails: report the error, do NOT use `rm -rf`
- Only cherry-pick commits from the current worktree branch
- ALWAYS verify commits actually landed on main — never claim success without verification
- NEVER remove a worktree until you have verified (via `git log`) that all cherry-picked commits are on main
- If verification fails, leave the worktree intact and report the error — the worktree is the only remaining copy of the work
