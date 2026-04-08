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

3. **Cherry-pick to main**
   - Run `git checkout main`
   - For each commit (oldest first): `git cherry-pick <sha>`
   - If a conflict occurs:
     * Run `git diff --name-only --diff-filter=U` to list conflicting files
     * For each conflicting file: read the file content (it will have `<<<<<<<`, `=======`, `>>>>>>>` conflict markers)
     * Resolve the conflict by keeping both changes: remove the conflict markers and merge both sides intelligently, preserving the worktree's new code AND main's existing code
     * Stage resolved files with `git add <file>`
     * Continue with `git cherry-pick --continue`
     * Only if resolution fails or produces broken code: abort with `git cherry-pick --abort` and report
   - On success: report which commits were cherry-picked

3.5. **Verify commits landed on main**
   - While still on `main` branch, run `git log --oneline -5` to see recent commits
   - For each commit that was cherry-picked, verify its message appears in the log
   - If ANY cherry-picked commit is missing from main's log: STOP and report failure. Do NOT proceed to worktree removal.
   - This is a critical safety check — skipping it can cause silent data loss

4. **Report success** (BEFORE removing the worktree)
   - Output a summary of what was committed, cherry-picked, and is ready for cleanup
   - Include the worktree path and branch name you are about to delete
   - This step MUST run while the worktree directory still exists (before step 5)

5. **Remove worktree and prune branch in one Bash call**
   - Determine the worktree path (you are running inside it — use `git worktree list` if needed)
   - Determine the main repo root from `git worktree list` (the first entry without a branch suffix)
   - Run the following as a SINGLE Bash command (so the shell starts while the worktree still exists, cds away immediately, then cleans up):
     ```
     cd <main_repo_root> && git worktree remove <worktree_path> --force && git branch -D <branch_name>
     ```
   - CRITICAL: Only run this if step 3.5 verified all commits landed on main
   - CRITICAL: This must be the LAST Bash call you make. After this call, the worktree directory is gone and your session CWD is permanently invalid. The Bash tool checks CWD before executing — even commands starting with `cd /other/path && ...` will fail with "Working directory no longer exists." There is NO workaround. Do NOT retry, do NOT try alternative approaches (bash -c, env -i, --git-dir, etc.) — they ALL fail. Just output your final summary and stop.
   - If this command fails: report the cleanup error. The merge itself succeeded (verified in step 3.5), so this is a non-critical cleanup failure.

## Rules

- NEVER force-push or run `git push --force`
- NEVER modify git history on main (no rebase, no amend)
- If rebase conflicts occur (in worktree branch before cherry-pick):
  * Run `git diff --name-only --diff-filter=U` to list conflicting files
  * For each conflicting file: read the file content (it will have `<<<<<<<`, `=======`, `>>>>>>>` conflict markers)
  * Resolve the conflict by keeping both changes: remove the conflict markers and merge both sides intelligently, preserving the worktree's new code AND main's existing code
  * Stage resolved files with `git add <file>`
  * Continue with `git rebase --continue`
  * Only if resolution fails or produces broken code: abort with `git rebase --abort` and report
- If worktree remove fails: report the error, do NOT use `rm -rf`
- Only cherry-pick commits from the current worktree branch
- ALWAYS verify commits actually landed on main — never claim success without verification
- If rebase fails, try merge fallback — if both fail, STOP with clear error
- NEVER remove a worktree until you have verified (via `git log`) that all cherry-picked commits are on main
- If verification fails, leave the worktree intact and report the error — the worktree is the only remaining copy of the work
