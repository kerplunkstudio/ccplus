import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Socket } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';
import './TerminalTab.css';

interface TerminalTabProps {
  terminalId: string;
  cwd: string;
  socket: Socket | null;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({ terminalId, cwd, socket }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current || !socket) return;

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#18181b',
        foreground: '#e4e4e7',
        cursor: '#22d3ee',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#22d3ee',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#67e8f9',
        brightWhite: '#fafafa',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle terminal input
    term.onData((data) => {
      socket.emit('terminal_input', { terminalId, data });
    });

    // Spawn PTY on backend
    socket.emit('terminal_spawn', { terminalId, cwd });

    // Listen for output from backend
    const handleOutput = (data: { terminalId: string; data: string }) => {
      if (data.terminalId === terminalId && terminalRef.current) {
        terminalRef.current.write(data.data);
      }
    };

    const handleExit = (data: { terminalId: string; exitCode: number }) => {
      if (data.terminalId === terminalId && terminalRef.current) {
        const exitMessage = `\r\n\x1b[1;33m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`;
        terminalRef.current.write(exitMessage);
      }
    };

    socket.on('terminal_output', handleOutput);
    socket.on('terminal_exit', handleExit);

    // Handle resize with debouncing
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }

      resizeTimerRef.current = setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();
          const { cols, rows } = terminalRef.current;
          socket.emit('terminal_resize', { terminalId, cols, rows });
        }
      }, 100);
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Cleanup
    return () => {
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }

      resizeObserver.disconnect();
      socket.off('terminal_output', handleOutput);
      socket.off('terminal_exit', handleExit);
      socket.emit('terminal_kill', { terminalId });

      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
    };
  }, [terminalId, cwd, socket]);

  if (!socket) {
    return (
      <div className="terminal-tab">
        <div className="terminal-error">
          <p>Socket connection not available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-tab">
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
};
