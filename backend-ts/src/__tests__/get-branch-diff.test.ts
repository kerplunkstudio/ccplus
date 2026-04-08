/**
 * Regression tests for getBranchDiff (git-operations.ts)
 *
 * Bug: GET /api/sessions/:sessionId/diff returned empty diffs for sessions
 * with committed changes in worktrees. The existing getGitDiff only checked
 * for uncommitted (staged/unstaged) changes via `git diff HEAD`. When all
 * changes were already committed, it returned 0 files and the endpoint
 * reported an empty diff.
 *
 * Fix: getBranchDiff detects whether cwd is a git worktree and runs
 * `git diff main...HEAD` (worktree) or `git diff HEAD~1 HEAD` (regular repo)
 * to capture committed-but-not-yet-merged changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';

// Mock child_process before importing the module under test so that
// execFileSync is intercepted consistently.
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

// Import after mocking so the module receives the mocked execFileSync.
import { getBranchDiff } from '../git-operations.js';

const mockExecFileSync = vi.mocked(childProcess.execFileSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_DIFF = `diff --git a/src/feature.ts b/src/feature.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/feature.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  return 'world';
+}
`;

/**
 * Build a mock execFileSync that returns different values based on the git
 * subcommand being invoked.
 */
function buildExecMock({
  commonDir,
  gitDir,
  diff,
  diffThrows = false,
}: {
  commonDir: string;
  gitDir: string;
  diff: string;
  diffThrows?: boolean;
}) {
  return (cmd: string, args: string[], _opts?: unknown): string => {
    if (cmd !== 'git') return '';
    const sub = args[0];
    const flag = args[1];

    if (sub === 'rev-parse') {
      if (flag === '--git-common-dir') return commonDir;
      if (flag === '--git-dir') return gitDir;
    }

    if (sub === 'diff') {
      if (diffThrows) throw new Error('git diff failed');
      return diff;
    }

    return '';
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getBranchDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Regression: the core bug scenario
  // -------------------------------------------------------------------------

  it('regression: returns committed changes from a worktree (bug was empty result)', () => {
    // Simulate a git worktree: --git-common-dir != --git-dir
    mockExecFileSync.mockImplementation(
      buildExecMock({
        commonDir: '/repo/.git',
        gitDir: '/repo/.git/worktrees/my-branch',
        diff: SAMPLE_DIFF,
      }) as any
    );

    const result = getBranchDiff('/worktrees/my-branch');

    // Before the fix getBranchDiff did not exist; getGitDiff returned 0 files.
    // After the fix getBranchDiff must return the committed diff.
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('src/feature.ts');
    expect(result.files[0].status).toBe('added');
    expect(result.totalAdditions).toBe(3);
    expect(result.totalDeletions).toBe(0);
    expect(result.error).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------

  it('always returns a DiffResult object with a files array', () => {
    mockExecFileSync.mockImplementation(
      buildExecMock({
        commonDir: '/repo/.git',
        gitDir: '/repo/.git',
        diff: '',
      }) as any
    );

    const result = getBranchDiff('/repo');

    expect(result).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    expect(typeof result.totalAdditions).toBe('number');
    expect(typeof result.totalDeletions).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Worktree detection: uses git diff main...HEAD
  // -------------------------------------------------------------------------

  it('uses `git diff main...HEAD` when cwd is a worktree', () => {
    mockExecFileSync.mockImplementation(
      buildExecMock({
        commonDir: '/repo/.git',
        gitDir: '/repo/.git/worktrees/feature',
        diff: SAMPLE_DIFF,
      }) as any
    );

    getBranchDiff('/worktrees/feature');

    const diffCall = mockExecFileSync.mock.calls.find(
      ([, args]) => Array.isArray(args) && args[0] === 'diff'
    );
    expect(diffCall).toBeDefined();
    // Must compare against main (or master) using three-dot syntax
    const diffArgs = diffCall![1] as string[];
    expect(diffArgs[1]).toMatch(/^(main|master)\.\.\.HEAD$/);
  });

  // -------------------------------------------------------------------------
  // Regular repo: uses git diff HEAD~1 HEAD
  // -------------------------------------------------------------------------

  it('uses `git diff HEAD~1 HEAD` when cwd is a regular repo (not a worktree)', () => {
    // commonDir === gitDir means NOT a worktree
    mockExecFileSync.mockImplementation(
      buildExecMock({
        commonDir: '/repo/.git',
        gitDir: '/repo/.git',
        diff: SAMPLE_DIFF,
      }) as any
    );

    getBranchDiff('/repo');

    const diffCall = mockExecFileSync.mock.calls.find(
      ([, args]) => Array.isArray(args) && args[0] === 'diff'
    );
    expect(diffCall).toBeDefined();
    const diffArgs = diffCall![1] as string[];
    expect(diffArgs[1]).toBe('HEAD~1');
    expect(diffArgs[2]).toBe('HEAD');
  });

  // -------------------------------------------------------------------------
  // Worktree falls back to master when main is not found
  // -------------------------------------------------------------------------

  it('falls back to `master...HEAD` when main branch is not available in worktree', () => {
    let mainAttempted = false;

    mockExecFileSync.mockImplementation((cmd: string, args: string[], _opts?: unknown): string => {
      if (cmd !== 'git') return '';
      const sub = args[0];
      const flag = args[1];

      if (sub === 'rev-parse') {
        if (flag === '--git-common-dir') return '/repo/.git';
        if (flag === '--git-dir') return '/repo/.git/worktrees/feature';
      }

      if (sub === 'diff') {
        const ref = args[1] as string;
        if (ref === 'main...HEAD') {
          mainAttempted = true;
          throw new Error('unknown revision: main');
        }
        if (ref === 'master...HEAD') {
          return SAMPLE_DIFF;
        }
      }

      return '';
    });

    const result = getBranchDiff('/worktrees/feature');

    expect(mainAttempted).toBe(true);
    // Should have fallen back to master successfully
    expect(result.files).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Empty diff
  // -------------------------------------------------------------------------

  it('returns empty files array when diff output is empty', () => {
    mockExecFileSync.mockImplementation(
      buildExecMock({
        commonDir: '/repo/.git',
        gitDir: '/repo/.git',
        diff: '',
      }) as any
    );

    const result = getBranchDiff('/repo');

    expect(result.files).toHaveLength(0);
    expect(result.totalAdditions).toBe(0);
    expect(result.totalDeletions).toBe(0);
    expect(result.error).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Totals aggregation
  // -------------------------------------------------------------------------

  it('aggregates totalAdditions and totalDeletions across all files', () => {
    const multiFileDiff = `diff --git a/a.ts b/a.ts
new file mode 100644
index 0000000..aaaaaaa
--- /dev/null
+++ b/a.ts
@@ -0,0 +1,2 @@
+line 1
+line 2
diff --git a/b.ts b/b.ts
index bbbbbbb..ccccccc 100644
--- a/b.ts
+++ b/b.ts
@@ -1,3 +1,1 @@
-removed 1
-removed 2
 kept
`;

    mockExecFileSync.mockImplementation(
      buildExecMock({
        commonDir: '/repo/.git',
        gitDir: '/repo/.git',
        diff: multiFileDiff,
      }) as any
    );

    const result = getBranchDiff('/repo');

    expect(result.files).toHaveLength(2);
    expect(result.totalAdditions).toBe(2);
    expect(result.totalDeletions).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Error resilience: git subprocess failure
  // -------------------------------------------------------------------------

  it('returns empty result (not a throw) when all git subcommands fail', () => {
    // isGitWorktree catches rev-parse errors and returns false (non-worktree path).
    // Then diff HEAD~1 HEAD also fails — the inner try/catch swallows it and
    // rawDiff stays ''. The outer function returns an empty-but-valid result.
    mockExecFileSync.mockImplementation((cmd: string, args: string[]): string => {
      if (cmd === 'git') throw new Error('not a git repository');
      return '';
    });

    const result = getBranchDiff('/not-a-repo');

    // Must not throw — always returns a DiffResult
    expect(result).toBeDefined();
    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files).toHaveLength(0);
    expect(result.totalAdditions).toBe(0);
    expect(result.totalDeletions).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Max files limit (50)
  // -------------------------------------------------------------------------

  it('limits output to 50 files when diff contains more', () => {
    // Build a diff with 60 files
    const manyFileDiff = Array.from({ length: 60 }, (_, i) =>
      `diff --git a/file${i}.ts b/file${i}.ts\nnew file mode 100644\nindex 0000000..aaaaaaa\n--- /dev/null\n+++ b/file${i}.ts\n@@ -0,0 +1,1 @@\n+line\n`
    ).join('');

    mockExecFileSync.mockImplementation(
      buildExecMock({
        commonDir: '/repo/.git',
        gitDir: '/repo/.git',
        diff: manyFileDiff,
      }) as any
    );

    const result = getBranchDiff('/repo');

    expect(result.files.length).toBeLessThanOrEqual(50);
  });
});
