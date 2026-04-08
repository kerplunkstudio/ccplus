import { execFileSync } from 'child_process';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DiffLine {
  type: 'addition' | 'deletion' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  oldPath?: string;
}

export interface DiffResult {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  error?: string;
}

export interface CommitResult {
  success: boolean;
  commitHash?: string;
  error?: string;
}

export interface DiscardResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Git Operations
// ---------------------------------------------------------------------------

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 50;

/**
 * Check if a directory is a git repository
 */
export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get git diff for the working directory
 */
export function getGitDiff(cwd: string): DiffResult {
  try {
    let rawDiff: string;

    // Try git diff HEAD first
    try {
      rawDiff = execFileSync('git', ['diff', 'HEAD'], {
        cwd,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (headError) {
      // If no HEAD (initial commit scenario), fall back to git diff
      rawDiff = execFileSync('git', ['diff'], {
        cwd,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        stdio: 'pipe'
      });
    }

    const files = parseUnifiedDiff(rawDiff);

    // Limit to MAX_FILES
    const limitedFiles = files.slice(0, MAX_FILES);

    const totalAdditions = limitedFiles.reduce((sum, file) => sum + file.additions, 0);
    const totalDeletions = limitedFiles.reduce((sum, file) => sum + file.deletions, 0);

    return {
      files: limitedFiles,
      totalAdditions,
      totalDeletions
    };
  } catch (error) {
    return {
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      error: String(error)
    };
  }
}

/**
 * Parse unified diff output into structured format
 */
export function parseUnifiedDiff(rawDiff: string): DiffFile[] {
  if (!rawDiff.trim()) {
    return [];
  }

  const lines = rawDiff.split('\n');
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file header: diff --git a/... b/...
    if (line.startsWith('diff --git ')) {
      // Save previous file
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentFile) {
        files.push(currentFile);
      }

      // Parse file paths from "diff --git a/path b/path"
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (match) {
        const [, pathA, pathB] = match;
        currentFile = {
          path: pathB,
          status: 'modified',
          additions: 0,
          deletions: 0,
          hunks: []
        };
      }
      continue;
    }

    if (!currentFile) continue;

    // New file mode
    if (line.startsWith('new file mode')) {
      currentFile.status = 'added';
      continue;
    }

    // Deleted file mode
    if (line.startsWith('deleted file mode')) {
      currentFile.status = 'deleted';
      continue;
    }

    // Rename from
    if (line.startsWith('rename from ')) {
      currentFile.status = 'renamed';
      currentFile.oldPath = line.substring('rename from '.length);
      continue;
    }

    // Rename to
    if (line.startsWith('rename to ')) {
      currentFile.status = 'renamed';
      currentFile.path = line.substring('rename to '.length);
      continue;
    }

    // Binary file
    if (line.startsWith('Binary files ')) {
      // Binary files have no hunks
      continue;
    }

    // Hunk header: @@ -N,M +N,M @@
    if (line.startsWith('@@')) {
      // Save previous hunk
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        const [, oldStartStr, oldCountStr, newStartStr, newCountStr, header] = hunkMatch;
        oldLineNumber = parseInt(oldStartStr, 10);
        newLineNumber = parseInt(newStartStr, 10);

        currentHunk = {
          header: header.trim(),
          oldStart: oldLineNumber,
          oldCount: oldCountStr ? parseInt(oldCountStr, 10) : 1,
          newStart: newLineNumber,
          newCount: newCountStr ? parseInt(newCountStr, 10) : 1,
          lines: []
        };
      }
      continue;
    }

    // Content lines
    if (currentHunk) {
      if (line.startsWith('+')) {
        const diffLine: DiffLine = {
          type: 'addition',
          content: line.substring(1),
          oldLineNumber: null,
          newLineNumber
        };
        currentHunk.lines.push(diffLine);
        currentFile.additions++;
        newLineNumber++;
      } else if (line.startsWith('-')) {
        const diffLine: DiffLine = {
          type: 'deletion',
          content: line.substring(1),
          oldLineNumber,
          newLineNumber: null
        };
        currentHunk.lines.push(diffLine);
        currentFile.deletions++;
        oldLineNumber++;
      } else if (line.startsWith(' ')) {
        const diffLine: DiffLine = {
          type: 'context',
          content: line.substring(1),
          oldLineNumber,
          newLineNumber
        };
        currentHunk.lines.push(diffLine);
        oldLineNumber++;
        newLineNumber++;
      } else if (line === '' && i === lines.length - 1) {
        // Last empty line, ignore
      } else {
        // Context line without leading space (edge case)
        const diffLine: DiffLine = {
          type: 'context',
          content: line,
          oldLineNumber,
          newLineNumber
        };
        currentHunk.lines.push(diffLine);
        oldLineNumber++;
        newLineNumber++;
      }
    }
  }

  // Save last hunk and file
  if (currentFile && currentHunk) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

/**
 * Get diff for a specific commit: git diff <hash>~1..<hash>
 * Returns empty DiffResult if the hash is invalid or directory does not exist.
 */
export function getCommitDiff(cwd: string, commitHash: string): DiffResult {
  try {
    const rawDiff = execFileSync(
      'git',
      ['diff', `${commitHash}~1..${commitHash}`],
      {
        cwd,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        stdio: 'pipe',
      }
    );

    const files = parseUnifiedDiff(rawDiff);
    const limitedFiles = files.slice(0, MAX_FILES);
    const totalAdditions = limitedFiles.reduce((sum, file) => sum + file.additions, 0);
    const totalDeletions = limitedFiles.reduce((sum, file) => sum + file.deletions, 0);

    return { files: limitedFiles, totalAdditions, totalDeletions };
  } catch {
    return { files: [], totalAdditions: 0, totalDeletions: 0 };
  }
}

/**
 * Detect whether a directory is a git worktree (not the main working tree)
 */
function isGitWorktree(cwd: string): boolean {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    return commonDir !== gitDir;
  } catch {
    return false;
  }
}

/**
 * Get git diff comparing the current branch to main/master (for worktrees)
 * or HEAD~1 (for regular repos). Used when getGitDiff returns no changes
 * because all changes have already been committed.
 */
export function getBranchDiff(cwd: string): DiffResult {
  try {
    const worktree = isGitWorktree(cwd);
    let rawDiff = '';

    if (worktree) {
      // Worktree: compare branch to main or master
      const bases = ['main', 'master'];
      for (const base of bases) {
        try {
          rawDiff = execFileSync('git', ['diff', `${base}...HEAD`], {
            cwd,
            maxBuffer: MAX_BUFFER,
            encoding: 'utf8',
            stdio: 'pipe'
          });
          break;
        } catch {
          // Try next base branch
        }
      }
    } else {
      // Regular repo: compare to previous commit
      try {
        rawDiff = execFileSync('git', ['diff', 'HEAD~1', 'HEAD'], {
          cwd,
          maxBuffer: MAX_BUFFER,
          encoding: 'utf8',
          stdio: 'pipe'
        });
      } catch {
        // No previous commit — return empty
      }
    }

    const files = parseUnifiedDiff(rawDiff);
    const limitedFiles = files.slice(0, MAX_FILES);
    const totalAdditions = limitedFiles.reduce((sum, file) => sum + file.additions, 0);
    const totalDeletions = limitedFiles.reduce((sum, file) => sum + file.deletions, 0);

    return {
      files: limitedFiles,
      totalAdditions,
      totalDeletions
    };
  } catch (error) {
    return {
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
      error: String(error)
    };
  }
}

/**
 * Commit all changes in the working directory
 */
export function commitChanges(cwd: string, message: string): CommitResult {
  try {
    // Stage all changes
    execFileSync('git', ['add', '-A'], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      stdio: 'pipe'
    });

    // Commit
    const output = execFileSync('git', ['commit', '-m', message], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      stdio: 'pipe'
    });

    // Extract commit hash from output
    const match = output.match(/\[.+ ([a-f0-9]+)\]/);
    const commitHash = match ? match[1] : undefined;

    return {
      success: true,
      commitHash
    };
  } catch (error) {
    const errorStr = String(error);

    // Check if it's "nothing to commit"
    if (errorStr.includes('nothing to commit')) {
      return {
        success: true
      };
    }

    return {
      success: false,
      error: errorStr
    };
  }
}

/**
 * Discard all changes in the working directory
 */
export function discardChanges(cwd: string): DiscardResult {
  try {
    execFileSync('git', ['checkout', '--', '.'], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      stdio: 'pipe'
    });

    execFileSync('git', ['clean', '-fd'], {
      cwd,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      stdio: 'pipe'
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: String(error)
    };
  }
}
