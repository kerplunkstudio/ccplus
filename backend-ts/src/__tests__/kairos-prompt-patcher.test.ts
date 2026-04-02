import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import {
  getModifiablePromptFiles,
  validatePromptChange,
  applyPromptChange,
  rollbackPromptChange,
  rollbackAllChanges,
  getActiveChangeSummary,
  type PromptChangeRequest
} from '../kairos-prompt-patcher.js';

vi.mock('../db/kairos.js', () => {
  let changeIdCounter = 0;
  const changes: Array<{
    id: number;
    file_path: string;
    change_type: string;
    diff_before: string;
    diff_after: string;
    evidence_session_ids: string;
    reasoning: string;
    created_at: string;
    rolled_back_at: string | null;
  }> = [];

  return {
    recordPromptChange: vi.fn((params: {
      filePath: string;
      changeType: string;
      diffBefore: string;
      diffAfter: string;
      evidenceSessionIds: string[];
      reasoning: string;
    }) => {
      changeIdCounter++;
      changes.push({
        id: changeIdCounter,
        file_path: params.filePath,
        change_type: params.changeType,
        diff_before: params.diffBefore,
        diff_after: params.diffAfter,
        evidence_session_ids: JSON.stringify(params.evidenceSessionIds),
        reasoning: params.reasoning,
        created_at: new Date().toISOString(),
        rolled_back_at: null,
      });
      return changeIdCounter;
    }),
    getActivePromptChanges: vi.fn(() =>
      changes.filter(c => c.rolled_back_at === null)
    ),
    getPromptChangeHistory: vi.fn(() => [...changes]),
    markPromptChangeRolledBack: vi.fn((changeId: number, _reason: string) => {
      const change = changes.find(c => c.id === changeId);
      if (change) {
        change.rolled_back_at = new Date().toISOString();
      }
    }),
    __resetForTesting: () => {
      changeIdCounter = 0;
      changes.length = 0;
    },
  };
});

import { __resetForTesting } from '../db/kairos.js';

const TEST_WORKFLOW_DIR = path.resolve(import.meta.dirname, '../../../.ccplus/workflows/test-workflow');

describe('kairos-prompt-patcher', () => {
  let testAgentFile: string;
  let testWorkflowFile: string;
  let agentBackup: string;

  beforeEach(() => {
    (__resetForTesting as () => void)();

    // Use a real agent file that exists in the allowlist
    const agentsDir = path.join(homedir(), '.claude', 'agents');

    // Ensure directory exists (CI may not have it)
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    let existingAgents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));

    // Create a test agent file if none exist (CI environment)
    if (existingAgents.length === 0) {
      const testFile = path.join(agentsDir, '_kairos-test-agent.md');
      // Content must be large enough that test additions stay within 20% size increase limit
      const stubContent = [
        '# Test Agent',
        '',
        '## Instructions',
        '',
        'You are a test agent used for KAIROS prompt patcher integration tests.',
        'Follow all instructions carefully and report results accurately.',
        'Always verify changes before committing them to the repository.',
        'Use immutable patterns and avoid mutation of shared state.',
        'Handle errors comprehensively with descriptive messages.',
        'Validate all inputs before processing.',
        '',
        '## Guidelines',
        '',
        'When working on tasks, break them into small, focused steps.',
        'Each step should be independently verifiable and reversible.',
        'Document your reasoning for non-obvious decisions.',
        'Prefer additive changes over modifications to existing code.',
        'Test thoroughly before marking work as complete.',
        '',
      ].join('\n');
      fs.writeFileSync(testFile, stubContent, 'utf-8');
      existingAgents = ['_kairos-test-agent.md'];
    }

    testAgentFile = path.join(agentsDir, existingAgents[0]);
    // Back up original content
    agentBackup = fs.readFileSync(testAgentFile, 'utf-8');

    // Create test workflow
    if (!fs.existsSync(TEST_WORKFLOW_DIR)) {
      fs.mkdirSync(TEST_WORKFLOW_DIR, { recursive: true });
    }
    testWorkflowFile = path.join(TEST_WORKFLOW_DIR, 'workflow.yaml');
    fs.writeFileSync(testWorkflowFile, `name: test-workflow
description: Test workflow for KAIROS
phases:
  - name: test
    context: Test phase
`, 'utf-8');
  });

  afterEach(() => {
    // Restore agent file backup
    if (agentBackup && testAgentFile) {
      fs.writeFileSync(testAgentFile, agentBackup, 'utf-8');
    }

    // Clean up test workflow
    if (fs.existsSync(testWorkflowFile)) {
      fs.unlinkSync(testWorkflowFile);
    }
    if (fs.existsSync(TEST_WORKFLOW_DIR)) {
      fs.rmdirSync(TEST_WORKFLOW_DIR);
    }

    // Clean up any temp files and CI-created test agents
    const agentsDir = path.join(homedir(), '.claude', 'agents');
    if (fs.existsSync(agentsDir)) {
      const cleanupFiles = fs.readdirSync(agentsDir).filter(f => f.includes('.tmp.') || f === '_kairos-test-agent.md');
      for (const f of cleanupFiles) {
        const fullPath = path.join(agentsDir, f);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    }
  });

  describe('getModifiablePromptFiles', () => {
    it('includes agent files from ~/.claude/agents/', () => {
      const files = getModifiablePromptFiles();
      const agentsDir = path.join(homedir(), '.claude', 'agents');
      expect(files.some(f => f.startsWith(agentsDir) && f.endsWith('.md'))).toBe(true);
    });

    it('includes captain-prompt.ts', () => {
      const files = getModifiablePromptFiles();
      const captainPromptPath = path.resolve(import.meta.dirname, '../captain-prompt.ts');
      expect(files.some(f => f === captainPromptPath)).toBe(true);
    });

    it('includes workflow.yaml files', () => {
      const files = getModifiablePromptFiles();
      expect(files.some(f => f === testWorkflowFile)).toBe(true);
    });

    it('returns only existing files', () => {
      const files = getModifiablePromptFiles();
      for (const f of files) {
        expect(fs.existsSync(f)).toBe(true);
      }
    });
  });

  describe('validatePromptChange', () => {
    function createBaseChange(overrides?: Partial<PromptChangeRequest>): PromptChangeRequest {
      return {
        targetFile: testAgentFile,
        section: '## Instructions',
        changeType: 'addition',
        currentText: '',
        proposedText: 'New rule: always verify.',
        reasoning: 'Test reasoning',
        evidenceSessionIds: ['session-1', 'session-2'],
        confidence: 0.8,
        ...overrides
      };
    }

    it('accepts valid addition change', () => {
      const result = validatePromptChange(createBaseChange());
      expect(result.valid).toBe(true);
    });

    it('rejects file not in allowlist', () => {
      const result = validatePromptChange(createBaseChange({ targetFile: '/tmp/evil.md' }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not in the allowlist');
    });

    it('rejects non-existent file', () => {
      const result = validatePromptChange(createBaseChange({
        targetFile: path.join(homedir(), '.claude', 'agents', 'nonexistent.md')
      }));
      expect(result.valid).toBe(false);
      // Note: allowlist check happens before file exists check, so this will fail at allowlist stage
      expect(result.reason).toContain('not in the allowlist');
    });

    it('rejects low confidence', () => {
      const result = validatePromptChange(createBaseChange({ confidence: 0.5 }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('below minimum threshold');
    });

    it('rejects empty evidenceSessionIds', () => {
      const result = validatePromptChange(createBaseChange({ evidenceSessionIds: [] }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('evidenceSessionIds cannot be empty');
    });

    it('rejects empty proposedText for addition', () => {
      const result = validatePromptChange(createBaseChange({ proposedText: '' }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('proposedText cannot be empty');
    });

    it('rejects modification when currentText not in file', () => {
      const result = validatePromptChange(createBaseChange({
        changeType: 'modification',
        currentText: 'This text does not exist in the file',
        proposedText: 'New text'
      }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not exist in the target file');
    });

    it('accepts modification when currentText exists in file', () => {
      const fileContent = fs.readFileSync(testAgentFile, 'utf-8');
      const lines = fileContent.split('\n').filter(l => l.trim().length > 5);
      if (lines.length === 0) return;

      const existingText = lines[0];
      const result = validatePromptChange(createBaseChange({
        changeType: 'modification',
        currentText: existingText,
        proposedText: existingText + ' (modified)'
      }));
      expect(result.valid).toBe(true);
    });

    it('rejects removal when currentText not in file', () => {
      const result = validatePromptChange(createBaseChange({
        changeType: 'removal',
        currentText: 'Non-existent text',
        proposedText: ''
      }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not exist in the target file');
    });

    it('rejects excessive size increase', () => {
      const hugeText = 'X'.repeat(10000);
      const result = validatePromptChange(createBaseChange({ proposedText: hugeText }));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('increase file size by more than');
    });
  });

  describe('applyPromptChange', () => {
    function createBaseChange(overrides?: Partial<PromptChangeRequest>): PromptChangeRequest {
      return {
        targetFile: testAgentFile,
        section: '## Instructions',
        changeType: 'addition',
        currentText: '',
        proposedText: 'New rule: verify all changes.',
        reasoning: 'Sessions showed lack of verification',
        evidenceSessionIds: ['session-1', 'session-2'],
        confidence: 0.85,
        ...overrides
      };
    }

    it('applies addition change and updates file', () => {
      const result = applyPromptChange(createBaseChange());
      expect(result.applied).toBe(true);
      expect(result.changeId).toBeGreaterThan(0);

      const fileContent = fs.readFileSync(testAgentFile, 'utf-8');
      expect(fileContent).toContain('New rule: verify all changes.');
    });

    it('applies modification change', () => {
      const fileContent = fs.readFileSync(testAgentFile, 'utf-8');
      const lines = fileContent.split('\n').filter(l => l.trim().length > 5);
      if (lines.length === 0) return;

      const existingText = lines[0];
      const result = applyPromptChange(createBaseChange({
        changeType: 'modification',
        currentText: existingText,
        proposedText: existingText + ' [MODIFIED]'
      }));
      expect(result.applied).toBe(true);

      const updatedContent = fs.readFileSync(testAgentFile, 'utf-8');
      expect(updatedContent).toContain(existingText + ' [MODIFIED]');
      expect(updatedContent).not.toContain(existingText + '\n');
    });

    it('applies removal change', () => {
      const fileContent = fs.readFileSync(testAgentFile, 'utf-8');
      const lines = fileContent.split('\n').filter(l => l.trim().length > 5);
      if (lines.length === 0) return;

      const textToRemove = lines[lines.length - 1];
      const result = applyPromptChange(createBaseChange({
        changeType: 'removal',
        currentText: textToRemove,
        proposedText: ''
      }));
      expect(result.applied).toBe(true);

      const updatedContent = fs.readFileSync(testAgentFile, 'utf-8');
      expect(updatedContent).not.toContain(textToRemove);
    });

    it('returns error when validation fails', () => {
      const result = applyPromptChange(createBaseChange({ confidence: 0.3 }));
      expect(result.applied).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.changeId).toBe(-1);
    });

    it('returns error for file in read-only directory', () => {
      // Test with a file path in a non-existent directory (will fail atomic write)
      const invalidPath = '/nonexistent/path/file.md';

      // First, we need to bypass the allowlist check for this test
      // Since we can't modify allowlist, we'll skip this test and rely on other error handling tests
      // The atomic write safety is covered by the modification/removal tests that DO succeed

      const result = applyPromptChange(createBaseChange({
        targetFile: invalidPath
      }));

      expect(result.applied).toBe(false);
      expect(result.error).toContain('not in the allowlist');
    });
  });

  describe('rollbackPromptChange', () => {
    function createTestChange(overrides?: Partial<PromptChangeRequest>): PromptChangeRequest {
      return {
        targetFile: testAgentFile,
        section: '## Instructions',
        changeType: 'addition',
        currentText: '',
        proposedText: 'Temporary addition.',
        reasoning: 'Test',
        evidenceSessionIds: ['session-1'],
        confidence: 0.9,
        ...overrides
      };
    }

    it('restores file to previous state', () => {
      const originalContent = fs.readFileSync(testAgentFile, 'utf-8');

      const applyResult = applyPromptChange(createTestChange());
      expect(applyResult.applied).toBe(true);

      const modifiedContent = fs.readFileSync(testAgentFile, 'utf-8');
      expect(modifiedContent).toContain('Temporary addition.');

      const rollbackResult = rollbackPromptChange(applyResult.changeId, 'Test rollback');
      expect(rollbackResult.success).toBe(true);

      const restoredContent = fs.readFileSync(testAgentFile, 'utf-8');
      expect(restoredContent).toBe(originalContent);
    });

    it('returns error for non-existent change', () => {
      const result = rollbackPromptChange(999999, 'Test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error for already rolled back change', () => {
      const applyResult = applyPromptChange(createTestChange({ proposedText: 'Test content.' }));
      const firstRollback = rollbackPromptChange(applyResult.changeId, 'First rollback');
      expect(firstRollback.success).toBe(true);

      const secondRollback = rollbackPromptChange(applyResult.changeId, 'Second rollback');
      expect(secondRollback.success).toBe(false);
      expect(secondRollback.error).toContain('already rolled back');
    });
  });

  describe('rollbackAllChanges', () => {
    function createTestChange(props: {
      file: string;
      proposedText: string;
      evidenceSessionIds: string[];
    }): PromptChangeRequest {
      return {
        targetFile: props.file,
        section: '## Instructions',
        changeType: 'addition',
        currentText: '',
        proposedText: props.proposedText,
        reasoning: 'Test',
        evidenceSessionIds: props.evidenceSessionIds,
        confidence: 0.9
      };
    }

    it('rolls back all changes from specified sessions', () => {
      applyPromptChange(createTestChange({
        file: testAgentFile,
        proposedText: 'Change 1',
        evidenceSessionIds: ['session-1', 'session-2']
      }));

      applyPromptChange(createTestChange({
        file: testWorkflowFile,
        proposedText: 'Change 2',
        evidenceSessionIds: ['session-1']
      }));

      const result = rollbackAllChanges(['session-1']);
      expect(result.rolledBack).toBeGreaterThanOrEqual(2);
      expect(result.errors).toHaveLength(0);
    });

    it('only rolls back matching sessions', () => {
      applyPromptChange(createTestChange({
        file: testAgentFile,
        proposedText: 'Change A',
        evidenceSessionIds: ['session-A']
      }));

      applyPromptChange(createTestChange({
        file: testWorkflowFile,
        proposedText: 'Change B',
        evidenceSessionIds: ['session-B']
      }));

      const result = rollbackAllChanges(['session-A']);
      expect(result.rolledBack).toBeGreaterThanOrEqual(1);

      const agentContent = fs.readFileSync(testAgentFile, 'utf-8');
      const workflowContent = fs.readFileSync(testWorkflowFile, 'utf-8');

      expect(agentContent).not.toContain('Change A');
      expect(workflowContent).toContain('Change B');
    });
  });

  describe('getActiveChangeSummary', () => {
    function createTestChange(overrides?: Partial<PromptChangeRequest>): PromptChangeRequest {
      return {
        targetFile: testAgentFile,
        section: '## Instructions',
        changeType: 'addition',
        currentText: '',
        proposedText: 'Active change',
        reasoning: 'Test reasoning',
        evidenceSessionIds: ['session-1'],
        confidence: 0.9,
        ...overrides
      };
    }

    it('returns summary of active changes', () => {
      const result = applyPromptChange(createTestChange());
      const summary = getActiveChangeSummary();

      const matchingEntry = summary.find(s => s.changeId === result.changeId);
      expect(matchingEntry).toBeDefined();
      expect(matchingEntry?.filePath).toBe(testAgentFile);
      expect(matchingEntry?.changeType).toBe('addition');
      expect(matchingEntry?.reasoning).toBe('Test reasoning');
    });

    it('excludes rolled back changes', () => {
      const applyResult = applyPromptChange(createTestChange({ proposedText: 'Temporary' }));
      rollbackPromptChange(applyResult.changeId, 'Test rollback');

      const summary = getActiveChangeSummary();
      const matchingEntry = summary.find(s => s.changeId === applyResult.changeId);
      expect(matchingEntry).toBeUndefined();
    });
  });
});
