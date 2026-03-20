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
  onClose: () => void;
  onMinimize: () => void;
  visible: boolean;
}

interface Position {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const STORAGE_KEY_POSITION = 'terminal-position';
const STORAGE_KEY_SIZE = 'terminal-size';
const MIN_WIDTH = 400;
const MIN_HEIGHT = 200;

export const TerminalTab: React.FC<TerminalTabProps> = ({ terminalId, cwd, socket, onClose, onMinimize, visible }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag/resize state
  const floatingRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<Position>({ x: 0, y: 0 });
  const sizeRef = useRef<Size>({ width: 600, height: 360 });
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; startWidth: number; startHeight: number }>({ mouseX: 0, mouseY: 0, startWidth: 0, startHeight: 0 });

  // Focus terminal when it becomes visible
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      if (terminalRef.current) {
        terminalRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [visible]);

  // Initialize position and size from localStorage
  useEffect(() => {
    const savedPosition = localStorage.getItem(STORAGE_KEY_POSITION);
    const savedSize = localStorage.getItem(STORAGE_KEY_SIZE);

    if (savedPosition) {
      positionRef.current = JSON.parse(savedPosition);
    } else {
      // Default to bottom-right corner
      positionRef.current = { x: window.innerWidth - 616, y: window.innerHeight - 376 };
    }

    if (savedSize) {
      sizeRef.current = JSON.parse(savedSize);
    }

    // Apply initial position and size
    if (floatingRef.current) {
      floatingRef.current.style.transform = `translate(${positionRef.current.x}px, ${positionRef.current.y}px)`;
      floatingRef.current.style.width = `${sizeRef.current.width}px`;
      floatingRef.current.style.height = `${sizeRef.current.height}px`;
    }
  }, []);

  // Drag and resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current && floatingRef.current) {
        const deltaX = e.clientX - dragStartRef.current.mouseX;
        const deltaY = e.clientY - dragStartRef.current.mouseY;

        let newX = dragStartRef.current.startX + deltaX;
        let newY = dragStartRef.current.startY + deltaY;

        // Constrain to viewport
        const maxX = window.innerWidth - sizeRef.current.width;
        const maxY = window.innerHeight - sizeRef.current.height;

        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));

        positionRef.current = { x: newX, y: newY };
        floatingRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
      }

      if (isResizingRef.current && floatingRef.current) {
        const deltaX = e.clientX - resizeStartRef.current.mouseX;
        const deltaY = e.clientY - resizeStartRef.current.mouseY;

        let newWidth = resizeStartRef.current.startWidth + deltaX;
        let newHeight = resizeStartRef.current.startHeight + deltaY;

        // Apply min/max constraints
        const maxWidth = window.innerWidth * 0.9;
        const maxHeight = window.innerHeight * 0.9;

        newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth));
        newHeight = Math.max(MIN_HEIGHT, Math.min(newHeight, maxHeight));

        sizeRef.current = { width: newWidth, height: newHeight };
        floatingRef.current.style.width = `${newWidth}px`;
        floatingRef.current.style.height = `${newHeight}px`;
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        localStorage.setItem(STORAGE_KEY_POSITION, JSON.stringify(positionRef.current));

        // Restore pointer events on terminal
        if (containerRef.current) {
          containerRef.current.style.pointerEvents = '';
        }
      }

      if (isResizingRef.current) {
        isResizingRef.current = false;
        localStorage.setItem(STORAGE_KEY_SIZE, JSON.stringify(sizeRef.current));

        // Restore pointer events on terminal
        if (containerRef.current) {
          containerRef.current.style.pointerEvents = '';
        }

        // Trigger final fit
        if (fitAddonRef.current && terminalRef.current && socket) {
          fitAddonRef.current.fit();
          const { cols, rows } = terminalRef.current;
          socket.emit('terminal_resize', { terminalId, cols, rows });
        }
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [terminalId, socket]);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: positionRef.current.x,
      startY: positionRef.current.y,
    };

    // Disable pointer events on terminal during drag
    if (containerRef.current) {
      containerRef.current.style.pointerEvents = 'none';
    }
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startWidth: sizeRef.current.width,
      startHeight: sizeRef.current.height,
    };

    // Disable pointer events on terminal during resize
    if (containerRef.current) {
      containerRef.current.style.pointerEvents = 'none';
    }
  };

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

    // Let app-level shortcuts pass through xterm
    term.attachCustomKeyEventHandler((e) => {
      // Ctrl+Tab / Ctrl+Shift+Tab: tab switching
      if (e.ctrlKey && e.key === 'Tab') return false;
      // Cmd+T / Cmd+W / Cmd+K / Cmd+Shift+T: app shortcuts
      if ((e.metaKey || e.ctrlKey) && ['t', 'w', 'k'].includes(e.key.toLowerCase())) return false;
      return true;
    });

    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

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
    <div ref={floatingRef} className="terminal-floating">
      <div className="terminal-floating-header" onMouseDown={handleHeaderMouseDown}>
        <span className="terminal-floating-title">Terminal</span>
        <div className="terminal-floating-actions" onMouseDown={(e) => e.stopPropagation()}>
          <button className="terminal-floating-btn" onClick={onMinimize} aria-label="Minimize terminal" title="Minimize">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button className="terminal-floating-btn terminal-floating-btn-close" onClick={onClose} aria-label="Close terminal" title="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="terminal-tab" onClick={() => terminalRef.current?.focus()}>
        <div ref={containerRef} className="terminal-container" />
      </div>
      <div className="terminal-resize-handle" onMouseDown={handleResizeMouseDown} />
    </div>
  );
};
