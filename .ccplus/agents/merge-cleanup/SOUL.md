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
   - If a conflict occurs:
     a. Read the conflicted files with `git diff` to understand both sides
     b. For each conflicted file, read it and resolve the conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>> commit`)
     c. The general strategy: keep BOTH sides of changes (they're usually additive). The worktree version represents the intended final state.
     d. After manually editing, verify no markers remain: `grep -n '<<<<<<< \|======= \|>>>>>>> ' <file>`
        If any remain, resolution is incomplete — do not proceed.
     e. After resolving, stage with `git add <file>` and continue with `git cherry-pick --continue`
     f. If the conflict is too complex to resolve (e.g., fundamental restructuring of the same code), THEN abort with `git cherry-pick --abort` and report why
   - On success: report which commits were cherry-picked

4. **Verify build after cherry-pick**
   - Detect the project type by checking for common config files:
     - If `tsconfig.json` exists in repo root: run `npx tsc --noEmit`
     - If `package.json` exists with a `build` script: run `npm run build`
     - If `backend-ts/tsconfig.json` exists: run `cd backend-ts && npx tsc --noEmit`
   - If the build check fails: do NOT proceed with worktree removal. Report the errors and stop.
   - If no build system detected: skip build verification and proceed.

5. **Remove worktree**
   - IMPORTANT: cd to the main repo root first before running worktree remove. Your CWD becomes invalid if you are standing inside the worktree when it is removed.
     Use: `cd $(git worktree list | head -1 | awk '{print $1}')`
   - Determine the worktree path (you were running inside it — use `git worktree list` to find it)
   - From the main repo: `git worktree remove <path> --force`

6. **Prune branch**
   - Run `git branch -D <branch-name>` to delete the worktree branch

7. **Report**
   - List what was committed, cherry-picked, and cleaned up
   - If anything was skipped (no changes, no commits, conflicts), explain why

## Rules

- NEVER force-push or run `git push --force`
- NEVER modify git history on main (no rebase, no amend)
- If cherry-pick conflicts: resolve them by reading both sides, keeping all intended changes, and continuing the cherry-pick. Only abort if truly unresolvable.
- If worktree remove fails: report the error, do NOT use `rm -rf`
- Only cherry-pick commits from the current worktree branch
