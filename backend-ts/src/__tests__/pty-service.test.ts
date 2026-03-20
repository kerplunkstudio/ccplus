import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as ptyService from '../pty-service.js';

describe('pty-service', () => {
  beforeEach(() => {
    // Clean up any existing terminals
    ptyService.killAllTerminals();
  });

  afterEach(() => {
    // Clean up after each test
    ptyService.killAllTerminals();
  });

  it('handles write to non-existent terminal gracefully', () => {
    expect(() => {
      ptyService.writeTerminal('non-existent', 'test');
    }).not.toThrow();
  });

  it('handles resize of non-existent terminal gracefully', () => {
    expect(() => {
      ptyService.resizeTerminal('non-existent', 80, 24);
    }).not.toThrow();
  });

  it('handles kill of non-existent terminal gracefully', () => {
    expect(() => {
      ptyService.killTerminal('non-existent');
    }).not.toThrow();
  });

  it('tracks active terminal count', () => {
    // Start with zero terminals
    expect(ptyService.getActiveTerminalCount()).toBe(0);

    // After killAllTerminals, still zero
    ptyService.killAllTerminals();
    expect(ptyService.getActiveTerminalCount()).toBe(0);
  });

  it('exports all expected functions', () => {
    expect(typeof ptyService.spawnTerminal).toBe('function');
    expect(typeof ptyService.writeTerminal).toBe('function');
    expect(typeof ptyService.resizeTerminal).toBe('function');
    expect(typeof ptyService.killTerminal).toBe('function');
    expect(typeof ptyService.killAllTerminals).toBe('function');
    expect(typeof ptyService.getActiveTerminalCount).toBe('function');
  });
});
