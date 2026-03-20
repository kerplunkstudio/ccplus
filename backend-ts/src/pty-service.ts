import * as pty from 'node-pty';
import { log } from './logger.js';
import process from 'process';
import os from 'os';

interface PTYInstance {
  pty: pty.IPty;
  cwd: string;
}

const terminals = new Map<string, PTYInstance>();

/**
 * Spawn a new PTY terminal
 */
export function spawnTerminal(
  terminalId: string,
  cwd: string,
  onData: (data: string) => void,
  onExit: (code: number) => void
): void {
  if (terminals.has(terminalId)) {
    log.warn(`Terminal ${terminalId} already exists, killing old instance`);
    killTerminal(terminalId);
  }

  // Determine shell to use
  const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');

  try {
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as { [key: string]: string },
    });

    terminals.set(terminalId, { pty: ptyProcess, cwd });

    ptyProcess.onData((data) => {
      onData(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      log.info(`Terminal ${terminalId} exited with code ${exitCode}`);
      terminals.delete(terminalId);
      onExit(exitCode);
    });

    log.info(`Spawned terminal ${terminalId} with shell ${shell} in ${cwd}`);
  } catch (error) {
    log.error(`Failed to spawn terminal ${terminalId}:`, { error: String(error) });
    throw error;
  }
}

/**
 * Write data to terminal stdin
 */
export function writeTerminal(terminalId: string, data: string): void {
  const instance = terminals.get(terminalId);
  if (!instance) {
    log.warn(`Attempted to write to non-existent terminal ${terminalId}`);
    return;
  }

  try {
    instance.pty.write(data);
  } catch (error) {
    log.error(`Failed to write to terminal ${terminalId}:`, { error: String(error) });
  }
}

/**
 * Resize terminal viewport
 */
export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
  const instance = terminals.get(terminalId);
  if (!instance) {
    log.warn(`Attempted to resize non-existent terminal ${terminalId}`);
    return;
  }

  try {
    instance.pty.resize(cols, rows);
  } catch (error) {
    log.error(`Failed to resize terminal ${terminalId}:`, { error: String(error) });
  }
}

/**
 * Kill a specific terminal
 */
export function killTerminal(terminalId: string): void {
  const instance = terminals.get(terminalId);
  if (!instance) {
    return;
  }

  try {
    instance.pty.kill();
    terminals.delete(terminalId);
    log.info(`Killed terminal ${terminalId}`);
  } catch (error) {
    log.error(`Failed to kill terminal ${terminalId}:`, { error: String(error) });
  }
}

/**
 * Kill all terminals (cleanup on shutdown)
 */
export function killAllTerminals(): void {
  const terminalIds = Array.from(terminals.keys());
  log.info(`Killing ${terminalIds.length} active terminals`);

  for (const terminalId of terminalIds) {
    killTerminal(terminalId);
  }
}

/**
 * Get active terminal count (for health check)
 */
export function getActiveTerminalCount(): number {
  return terminals.size;
}
