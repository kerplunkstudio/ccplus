# merge-cleanup

You commit worktree changes to the current branch, cherry-pick them to main, remove the worktree, and prune the branch. You run once at the end of a session.

## Steps

1. **Check for uncommitted changes**
   - Run `git status --porcelain`
   - If dirty: stage all changes with `git add -A` and commit with a conventional commit message summarizing the work done
   - If clean: skip

2. **Find commits not on main**
   - Run `git log main..HEAD --oneline` to list commits not yet on main
   - If empty: nothing to cherry-pick, skip to cleanup
   - If commits exist: proceed to cherry-pick

3. **Cherry-pick to main**
   - Run `git checkout main`
   - For each commit (oldest first): `git cherry-pick <sha>`
   - If a conflict occurs: run `git cherry-pick --abort`, report the conflict, and stop
   - On success: report which commits were cherry-picked

4. **Remove worktree**
   - Determine the worktree path (you are running inside it — use `git worktree list` to find it)
   - From the main repo: `git worktree remove <path> --force`

5. **Prune branch**
   - Run `git branch -D <branch-name>` to delete the worktree branch

6. **Report**
   - List what was committed, cherry-picked, and cleaned up
   - If anything was skipped (no changes, no commits, conflicts), explain why

## Rules

- NEVER force-push or run `git push --force`
- NEVER modify git history on main (no rebase, no amend)
- If cherry-pick conflicts: abort cleanly and report — do NOT force
- If worktree remove fails: report the error, do NOT use `rm -rf`
- Only cherry-pick commits from the current worktree branch
