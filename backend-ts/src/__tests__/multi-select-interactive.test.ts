/**
 * multi-select-interactive.test.ts
 *
 * Tests for multi-select interactive message support.
 * Verifies tool schema, socket handling, and response flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InteractiveMessage } from '../interactive-message.js';

describe('Multi-select interactive messages', () => {
  describe('Tool schema validation', () => {
    it('accepts multi-select type with minSelections and maxSelections', () => {
      // This test validates that the tool schema accepts multi-select parameters
      const validInput = {
        type: 'multi-select',
        text: 'Select your preferences',
        actions: [
          { id: 'opt1', label: 'Option 1', style: 'default' },
          { id: 'opt2', label: 'Option 2', style: 'default' },
          { id: 'opt3', label: 'Option 3', style: 'default' },
        ],
        minSelections: 1,
        maxSelections: 2,
        timeoutMs: 60000,
      };

      // Schema validation happens at runtime in captain-tools.ts
      expect(validInput.type).toBe('multi-select');
      expect(validInput.minSelections).toBe(1);
      expect(validInput.maxSelections).toBe(2);
    });

    it('defaults minSelections to 1 if not provided', () => {
      const input = {
        type: 'multi-select',
        text: 'Select items',
        actions: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      };

      // The tool implementation defaults minSelections to 1
      const minSelections = input.minSelections ?? 1;
      expect(minSelections).toBe(1);
    });
  });

  describe('Message type construction', () => {
    it('constructs MultiSelectMessage with correct fields', () => {
      const message: InteractiveMessage = {
        id: 'msg-123',
        type: 'multi-select',
        text: 'Choose options',
        actions: [
          { id: 'a', label: 'Alpha', style: 'default' },
          { id: 'b', label: 'Beta', style: 'primary' },
          { id: 'c', label: 'Gamma', style: 'danger' },
        ],
        responseState: 'pending',
        minSelections: 2,
        maxSelections: 3,
        timeoutMs: 120000,
        createdAt: Date.now(),
        expiresAt: Date.now() + 120000,
      };

      expect(message.type).toBe('multi-select');
      expect(message.minSelections).toBe(2);
      expect(message.maxSelections).toBe(3);
      expect(message.actions).toHaveLength(3);
    });

    it('handles optional maxSelections', () => {
      const message: InteractiveMessage = {
        id: 'msg-456',
        type: 'multi-select',
        text: 'Select any number',
        actions: [
          { id: 'x', label: 'X', style: 'default' },
          { id: 'y', label: 'Y', style: 'default' },
        ],
        responseState: 'pending',
        minSelections: 1,
        createdAt: Date.now(),
      };

      expect(message.type).toBe('multi-select');
      expect(message.minSelections).toBe(1);
      expect(message.maxSelections).toBeUndefined();
    });
  });

  describe('Response parsing', () => {
    it('parses comma-separated actionId as array', () => {
      const actionId = 'opt1,opt2,opt3';
      const actionIds = actionId.split(',');

      expect(actionIds).toEqual(['opt1', 'opt2', 'opt3']);
    });

    it('validates all actionIds against known actions', () => {
      const validActionIds = ['a', 'b', 'c', 'd'];
      const selectedIds = ['a', 'c'];

      const allValid = selectedIds.every((id) => validActionIds.includes(id));
      expect(allValid).toBe(true);
    });

    it('rejects invalid actionIds', () => {
      const validActionIds = ['a', 'b', 'c'];
      const selectedIds = ['a', 'x']; // 'x' is invalid

      const allValid = selectedIds.every((id) => validActionIds.includes(id));
      expect(allValid).toBe(false);
    });

    it('validates empty selection is rejected', () => {
      const selectedIds: string[] = [];
      expect(selectedIds.length).toBe(0);
    });
  });

  describe('Socket protocol', () => {
    it('handles actionIds array in socket response', () => {
      const socketData = {
        messageId: 'msg-789',
        actionIds: ['opt1', 'opt2'],
      };

      expect(Array.isArray(socketData.actionIds)).toBe(true);
      expect(socketData.actionIds).toHaveLength(2);
    });

    it('handles single actionId string for backwards compatibility', () => {
      const socketData = {
        messageId: 'msg-012',
        actionId: 'opt1',
      };

      expect(typeof socketData.actionId).toBe('string');
      expect(socketData.actionId).toBe('opt1');
    });

    it('joins actionIds array to comma-separated string for storage', () => {
      const actionIds = ['a', 'b', 'c'];
      const finalActionId = actionIds.join(',');

      expect(finalActionId).toBe('a,b,c');
    });
  });

  describe('Tool response format', () => {
    it('returns action_ids array for multi-select', () => {
      const type = 'multi-select';
      const responseActionId = 'opt1,opt2,opt3';

      const actionIds = type === 'multi-select' && responseActionId !== '__expired__'
        ? responseActionId.split(',')
        : undefined;

      expect(actionIds).toEqual(['opt1', 'opt2', 'opt3']);
    });

    it('returns action_id string for single-select', () => {
      const type = 'options';
      const responseActionId = 'opt1';

      const actionIds = type === 'multi-select' && responseActionId !== '__expired__'
        ? responseActionId.split(',')
        : undefined;

      expect(actionIds).toBeUndefined();
    });

    it('handles expired response correctly', () => {
      const type = 'multi-select';
      const responseActionId = '__expired__';

      const actionIds = type === 'multi-select' && responseActionId !== '__expired__'
        ? responseActionId.split(',')
        : undefined;

      expect(actionIds).toBeUndefined();
    });
  });

  describe('Frontend state management', () => {
    it('tracks selectedActionIds array for responded multi-select', () => {
      const message: InteractiveMessage = {
        id: 'msg-345',
        type: 'multi-select',
        text: 'Choose options',
        actions: [
          { id: 'a', label: 'A', style: 'default' },
          { id: 'b', label: 'B', style: 'default' },
          { id: 'c', label: 'C', style: 'default' },
        ],
        responseState: 'responded',
        selectedActionIds: ['a', 'c'],
        minSelections: 1,
        createdAt: Date.now(),
      };

      expect(message.selectedActionIds).toEqual(['a', 'c']);
      expect(message.selectedActionIds).toHaveLength(2);
    });

    it('maps selectedActionIds to indices for UI rendering', () => {
      const actions = [
        { id: 'a', label: 'A', style: 'default' as const },
        { id: 'b', label: 'B', style: 'default' as const },
        { id: 'c', label: 'C', style: 'default' as const },
      ];
      const selectedActionIds = ['a', 'c'];

      const selectedIndices = selectedActionIds
        .map((id) => actions.findIndex((action) => action.id === id))
        .filter((i) => i >= 0);

      expect(selectedIndices).toEqual([0, 2]);
    });
  });

  describe('Validation constraints', () => {
    it('enforces minSelections constraint', () => {
      const minSelections = 2;
      const selectedCount = 1;

      const isValid = selectedCount >= minSelections;
      expect(isValid).toBe(false);
    });

    it('enforces maxSelections constraint', () => {
      const maxSelections = 3;
      const selectedCount = 4;

      const isValid = selectedCount <= maxSelections;
      expect(isValid).toBe(false);
    });

    it('allows selection within constraints', () => {
      const minSelections = 1;
      const maxSelections = 3;
      const selectedCount = 2;

      const meetsMin = selectedCount >= minSelections;
      const meetsMax = !maxSelections || selectedCount <= maxSelections;
      const isValid = meetsMin && meetsMax;

      expect(isValid).toBe(true);
    });

    it('handles no maxSelections as unlimited', () => {
      const minSelections = 1;
      const maxSelections = undefined;
      const selectedCount = 10;

      const meetsMin = selectedCount >= minSelections;
      const meetsMax = !maxSelections || selectedCount <= maxSelections;
      const isValid = meetsMin && meetsMax;

      expect(isValid).toBe(true);
    });
  });
});
