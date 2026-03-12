import { useState, useEffect } from 'react';
import { ToolDisplayMode } from '../types';

const STORAGE_KEY = 'ccplus_tool_display_mode';
const DEFAULT_MODE: ToolDisplayMode = 'minimal';

export function useToolDisplayMode(): [ToolDisplayMode, (mode: ToolDisplayMode) => void] {
  const [mode, setMode] = useState<ToolDisplayMode>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'minimal' || stored === 'verbose') {
      return stored;
    }
    return DEFAULT_MODE;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return [mode, setMode];
}
