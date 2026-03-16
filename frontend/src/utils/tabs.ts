import { TabState } from '../types';

export const ensureMruOrder = (tabs: TabState[], mruOrder?: string[]): string[] => {
  const tabIds = new Set(tabs.map(t => t.sessionId));
  const valid = (mruOrder || []).filter(id => tabIds.has(id));
  const missing = tabs.filter(t => !valid.includes(t.sessionId)).map(t => t.sessionId);
  return [...valid, ...missing];
};
