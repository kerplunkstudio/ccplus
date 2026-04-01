import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import * as kairosDb from './db/kairos.js';

export interface PromptChangeRequest {
  readonly targetFile: string;
  readonly section: string;
  readonly changeType: 'addition' | 'modification' | 'removal';
  readonly currentText: string;
  readonly proposedText: string;
  readonly reasoning: string;
  readonly evidenceSessionIds: readonly string[];
  readonly confidence: number;
}

export interface PromptChangeResult {
  readonly changeId: number;
  readonly applied: boolean;
  readonly error?: string;
}

interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

// Maximum file size increase allowed (20%)
const MAX_SIZE_INCREASE_RATIO = 1.2;

// Maximum active changes per file before rejecting new ones
const MAX_ACTIVE_CHANGES_PER_FILE = 10;

// Minimum confidence threshold
const MIN_CONFIDENCE = 0.6;

/**
 * Get list of files KAIROS is allowed to modify.
 * Returns absolute paths.
 */
export function getModifiablePromptFiles(): readonly string[] {
  const home = homedir();
  const agentsDir = path.join(home, '.claude', 'agents');
  const captainPromptFile = path.resolve(
    import.meta.dirname,
    'captain-prompt.ts'
  );
  const workflowsDir = path.resolve(import.meta.dirname, '../../.ccplus/workflows');

  const files: string[] = [];

  // All .md files in ~/.claude/agents/
  if (fs.existsSync(agentsDir)) {
    const agentFiles = fs.readdirSync(agentsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(agentsDir, f));
    files.push(...agentFiles);
  }

  // Captain prompt template
  if (fs.existsSync(captainPromptFile)) {
    files.push(captainPromptFile);
  }

  // All workflow.yaml files in .ccplus/workflows/*/workflow.yaml
  if (fs.existsSync(workflowsDir)) {
    const workflowNames = fs.readdirSync(workflowsDir);
    for (const name of workflowNames) {
      const workflowFile = path.join(workflowsDir, name, 'workflow.yaml');
      if (fs.existsSync(workflowFile)) {
        files.push(workflowFile);
      }
    }
  }

  return files;
}

/**
 * Validate a proposed change before applying.
 */
export function validatePromptChange(change: PromptChangeRequest): ValidationResult {
  // 1. Check allowlist
  const modifiableFiles = getModifiablePromptFiles();
  if (!modifiableFiles.includes(change.targetFile)) {
    return {
      valid: false,
      reason: `File ${change.targetFile} is not in the allowlist of modifiable files`
    };
  }

  // 2. Check file exists
  if (!fs.existsSync(change.targetFile)) {
    return {
      valid: false,
      reason: `Target file ${change.targetFile} does not exist`
    };
  }

  // 3. Check confidence threshold
  if (change.confidence < MIN_CONFIDENCE) {
    return {
      valid: false,
      reason: `Confidence ${change.confidence} is below minimum threshold ${MIN_CONFIDENCE}`
    };
  }

  // 4. Check evidenceSessionIds is not empty
  if (change.evidenceSessionIds.length === 0) {
    return {
      valid: false,
      reason: 'evidenceSessionIds cannot be empty'
    };
  }

  // 5. Check proposedText is not empty for addition/modification
  if ((change.changeType === 'addition' || change.changeType === 'modification') &&
      !change.proposedText.trim()) {
    return {
      valid: false,
      reason: 'proposedText cannot be empty for addition or modification'
    };
  }

  // 6. For modification and removal, verify currentText exists in the file
  const fileContent = fs.readFileSync(change.targetFile, 'utf-8');
  if ((change.changeType === 'modification' || change.changeType === 'removal') &&
      change.currentText && !fileContent.includes(change.currentText)) {
    return {
      valid: false,
      reason: 'currentText does not exist in the target file (stale recommendation)'
    };
  }

  // 7. Check size increase constraint
  const currentSize = fileContent.length;
  let projectedSize = currentSize;

  if (change.changeType === 'addition') {
    projectedSize = currentSize + change.proposedText.length;
  } else if (change.changeType === 'modification') {
    projectedSize = currentSize - change.currentText.length + change.proposedText.length;
  } else if (change.changeType === 'removal') {
    projectedSize = currentSize - change.currentText.length;
  }

  if (projectedSize > currentSize * MAX_SIZE_INCREASE_RATIO) {
    return {
      valid: false,
      reason: `Change would increase file size by more than ${Math.round((MAX_SIZE_INCREASE_RATIO - 1) * 100)}%`
    };
  }

  // 8. Check rate limit (max active changes per file)
  const activeChanges = kairosDb.getActivePromptChanges();
  const activeChangesForFile = activeChanges.filter(c => c.file_path === change.targetFile);
  if (activeChangesForFile.length >= MAX_ACTIVE_CHANGES_PER_FILE) {
    return {
      valid: false,
      reason: `File already has ${activeChangesForFile.length} active changes (max ${MAX_ACTIVE_CHANGES_PER_FILE})`
    };
  }

  return { valid: true };
}

/**
 * Apply a validated change to disk and record in database.
 * Uses atomic write (temp file + rename) for safety.
 */
export function applyPromptChange(change: PromptChangeRequest): PromptChangeResult {
  // Validate first
  const validation = validatePromptChange(change);
  if (!validation.valid) {
    return {
      changeId: -1,
      applied: false,
      error: validation.reason
    };
  }

  try {
    // Read current file content (this becomes diffBefore)
    const diffBefore = fs.readFileSync(change.targetFile, 'utf-8');

    // Apply the change
    let diffAfter: string;

    if (change.changeType === 'addition') {
      // Find section header and append after it, or append at end if no section
      if (change.section && diffBefore.includes(change.section)) {
        const sectionIndex = diffBefore.indexOf(change.section);
        const sectionEnd = diffBefore.indexOf('\n', sectionIndex);
        const insertPoint = sectionEnd !== -1 ? sectionEnd + 1 : diffBefore.length;
        diffAfter = diffBefore.slice(0, insertPoint) +
                    '\n' + change.proposedText + '\n' +
                    diffBefore.slice(insertPoint);
      } else {
        // No section found, append at end
        diffAfter = diffBefore + '\n' + change.proposedText + '\n';
      }
    } else if (change.changeType === 'modification') {
      // Replace currentText with proposedText
      diffAfter = diffBefore.replace(change.currentText, change.proposedText);
    } else if (change.changeType === 'removal') {
      // Remove currentText from file
      diffAfter = diffBefore.replace(change.currentText, '');
    } else {
      return {
        changeId: -1,
        applied: false,
        error: `Unknown changeType: ${change.changeType}`
      };
    }

    // Atomic write: write to temp file first
    const tempFile = change.targetFile + '.tmp.' + Date.now();
    fs.writeFileSync(tempFile, diffAfter, 'utf-8');

    // Verify the write succeeded by reading back
    const verification = fs.readFileSync(tempFile, 'utf-8');
    if (verification !== diffAfter) {
      fs.unlinkSync(tempFile);
      return {
        changeId: -1,
        applied: false,
        error: 'Write verification failed (content mismatch after write)'
      };
    }

    // Rename temp file to target (atomic on POSIX systems)
    fs.renameSync(tempFile, change.targetFile);

    // Record in database
    const changeId = kairosDb.recordPromptChange({
      filePath: change.targetFile,
      changeType: change.changeType,
      diffBefore,
      diffAfter,
      evidenceSessionIds: [...change.evidenceSessionIds],
      reasoning: change.reasoning
    });

    return {
      changeId,
      applied: true
    };
  } catch (error) {
    return {
      changeId: -1,
      applied: false,
      error: `Failed to apply change: ${String(error)}`
    };
  }
}

/**
 * Rollback a previously applied change.
 */
export function rollbackPromptChange(
  changeId: number,
  reason: string
): { readonly success: boolean; readonly error?: string } {
  try {
    // Get the change from database
    const allChanges = kairosDb.getPromptChangeHistory();
    const change = allChanges.find(c => c.id === changeId);

    if (!change) {
      return {
        success: false,
        error: `Change ${changeId} not found in database`
      };
    }

    if (change.rolled_back_at) {
      return {
        success: false,
        error: `Change ${changeId} was already rolled back at ${change.rolled_back_at}`
      };
    }

    // Restore the diff_before content (full snapshot)
    const tempFile = change.file_path + '.tmp.' + Date.now();
    fs.writeFileSync(tempFile, change.diff_before, 'utf-8');

    // Verify write
    const verification = fs.readFileSync(tempFile, 'utf-8');
    if (verification !== change.diff_before) {
      fs.unlinkSync(tempFile);
      return {
        success: false,
        error: 'Rollback write verification failed'
      };
    }

    // Atomic rename
    fs.renameSync(tempFile, change.file_path);

    // Mark as rolled back in database
    kairosDb.markPromptChangeRolledBack(changeId, reason);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Rollback failed: ${String(error)}`
    };
  }
}

/**
 * Rollback all changes from a specific analysis batch.
 */
export function rollbackAllChanges(
  evidenceSessionIds: readonly string[]
): { readonly rolledBack: number; readonly errors: readonly string[] } {
  const activeChanges = kairosDb.getActivePromptChanges();
  let rolledBackCount = 0;
  const errors: string[] = [];

  for (const change of activeChanges) {
    // Parse evidenceSessionIds from database (stored as JSON string)
    let changeSessionIds: string[];
    try {
      changeSessionIds = JSON.parse(change.evidence_session_ids);
    } catch {
      errors.push(`Failed to parse evidence_session_ids for change ${change.id}`);
      continue;
    }

    // Check if any session ID matches
    const hasMatch = evidenceSessionIds.some(sid =>
      changeSessionIds.includes(sid)
    );

    if (hasMatch) {
      const result = rollbackPromptChange(
        change.id,
        `Batch rollback for sessions: ${evidenceSessionIds.join(', ')}`
      );

      if (result.success) {
        rolledBackCount++;
      } else {
        errors.push(`Change ${change.id}: ${result.error || 'unknown error'}`);
      }
    }
  }

  return { rolledBack: rolledBackCount, errors };
}

/**
 * Get summary of all active (non-rolled-back) prompt changes.
 */
export function getActiveChangeSummary(): ReadonlyArray<{
  readonly changeId: number;
  readonly filePath: string;
  readonly changeType: string;
  readonly reasoning: string;
  readonly createdAt: string;
}> {
  const activeChanges = kairosDb.getActivePromptChanges();

  return activeChanges.map(change => ({
    changeId: change.id,
    filePath: change.file_path,
    changeType: change.change_type,
    reasoning: change.reasoning,
    createdAt: change.created_at
  }));
}
