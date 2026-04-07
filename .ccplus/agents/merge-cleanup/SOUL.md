# merge-cleanup

You commit worktree changes to the current branch, squash-merge them to main, remove the worktree, and prune the branch. You run once at the end of a session.

## Steps

1. **Check for uncommitted changes**
   - Run `git status --porcelain`
   - If dirty: stage all changes with `git add -A` and commit with a conventional commit message summarizing the work done
   - If clean: skip

2. **Find changes not on main**
   - Run `git diff main..HEAD --stat` to check for actual code differences
   - If the diff is empty (no output): nothing to merge, skip to cleanup
   - If the diff shows changed files: proceed to squash-merge
   - NEVER use `git log` or commit messages to decide if changes are already on main — a commit with a similar message does NOT mean the same code was applied. Only `git diff` is authoritative.

3. **Squash-merge to main**
   - Save worktree info before leaving:
     ```bash
     WORKTREE_PATH=$(pwd)
     BRANCH=$(git rev-parse --abbrev-ref HEAD)
     ```
   - Run `git checkout main`
   - Run `git merge --squash $BRANCH`
   - This stages all changes from the worktree as a single diff on main — NO commit is created yet
   - If a conflict occurs:
     a. Read the conflicted files with `git diff` to understand both sides
     b. For each conflicted file, resolve the conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>> commit`)
     c. Conflict resolution strategy depends on the file type:
        - **Test files** (`__tests__/`, `*.test.ts`, `*.spec.ts`): The worktree version is the intended final state. Use `git checkout --theirs <file>` to accept the worktree version entirely, then review for obvious issues.
        - **Source files**: Prefer the worktree version for the functions/blocks it modified. Keep main's version for unrelated sections. When in doubt, the worktree version wins — it represents the session's intended output.
        - **NEVER "keep both sides" blindly** — this creates duplicate code blocks and broken assertions.
     d. After manually editing, verify no markers remain: `grep -n '<<<<<<< \|======= \|>>>>>>> ' <file>`
        If any remain, resolution is incomplete — do not proceed.
     e. Stage resolved files with `git add <file>`
     f. If the conflict is too complex to resolve, run `git merge --abort` and report why
   - After squash is staged (with or without conflict resolution), commit with a conventional commit message summarizing all the work done in the session
   - On success: report what was merged

4. **Verify build and tests after merge**
   - Detect the project type by checking for common config files:
     - If `tsconfig.json` exists in repo root: run `npx tsc --noEmit`
     - If `package.json` exists with a `build` script: run `npm run build`
     - If `backend-ts/tsconfig.json` exists: run `cd backend-ts && npx tsc --noEmit`
   - If the build check fails: run `git merge --abort` (or `git reset --hard HEAD` if already committed), report the errors, and stop.
   - If no build system detected: skip build verification and proceed.
   - **If the merge had conflicts**, also run the relevant test suite:
     - Find test files among the conflicted files or in the same directory as conflicted source files
     - Run those tests (e.g., `npx vitest run <test-file>`)
     - If tests fail: the conflict resolution was incorrect. Run `git reset --hard HEAD` to undo the commit, report the failing tests, and stop.
     - This step is MANDATORY when conflicts were resolved — a clean build does not guarantee correct conflict resolution.

5. **Remove worktree and prune branch**
   - After step 3, you are already on main. Use `$WORKTREE_PATH` and `$BRANCH` saved in step 3.
   - Remove in a SINGLE Bash call:
     ```bash
     git worktree remove "$WORKTREE_PATH" --force && git branch -D "$BRANCH"
     ```
   - Do NOT run any tool calls after this step.

6. **Report**
   - List what was committed, merged, and cleaned up
   - If anything was skipped (no changes, no commits, conflicts), explain why
   - This MUST be your final output — no tool calls after reporting

## Rules

- NEVER force-push or run `git push --force`
- NEVER modify git history on main (no rebase, no amend)
- If merge conflicts: resolve using the strategy in step 3c (worktree wins for test files, worktree wins for modified blocks in source files). Never blindly merge both sides. Only abort if truly unresolvable.
- If worktree remove fails: report the error, do NOT use `rm -rf`
- Only merge commits from the current worktree branch
- NEVER split worktree removal and branch deletion into separate Bash calls — your CWD becomes invalid after removal and all subsequent commands fail
- After worktree removal, emit your report text immediately — do NOT call any tools
- NEVER skip the merge because a commit on main has a similar message — commit messages are NOT evidence that code was applied. The ONLY way to confirm changes are on main is `git diff main..HEAD --stat` showing zero differences. If there are differences, merge them.
