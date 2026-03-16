import { renderHook, act } from '@testing-library/react';
import { useWorkspace } from './useWorkspace';

// Mock fetch
global.fetch = jest.fn();

describe('useWorkspace', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Mock fetch to return empty workspace
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ projects: [], activeProjectPath: null }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ADD_TAB duplicate prevention', () => {
    it('should not create duplicate tabs when ADD_TAB is called with existing sessionId', () => {
      const { result } = renderHook(() => useWorkspace());

      // Add a project
      act(() => {
        result.current.addProject('/test/project', 'Test Project');
      });

      const projectPath = '/test/project';
      const initialTabCount = result.current.state.projects[0]!.tabs.length;
      const existingSessionId = result.current.state.projects[0]!.tabs[0]!.sessionId;

      // Try to add a tab with the same sessionId
      act(() => {
        result.current.addTab(projectPath, existingSessionId);
      });

      // Tab count should remain the same
      expect(result.current.state.projects[0]!.tabs.length).toBe(initialTabCount);

      // The existing tab should still be active
      expect(result.current.state.projects[0]!.activeTabId).toBe(existingSessionId);

      // The sessionId should be at the front of MRU
      const project = result.current.state.projects[0]!;
      expect(project.tabMruOrder?.[0]).toBe(existingSessionId);
    });

    it('should create new tab when ADD_TAB is called with new sessionId', () => {
      const { result } = renderHook(() => useWorkspace());

      // Add a project
      act(() => {
        result.current.addProject('/test/project', 'Test Project');
      });

      const projectPath = '/test/project';
      const initialTabCount = result.current.state.projects[0]!.tabs.length;

      // Add a new tab with a different sessionId
      act(() => {
        result.current.addTab(projectPath, 'new-session-id');
      });

      // Tab count should increase by 1
      expect(result.current.state.projects[0]!.tabs.length).toBe(initialTabCount + 1);

      // The new tab should be active
      expect(result.current.state.projects[0]!.activeTabId).toBe('new-session-id');

      // The new sessionId should exist in tabs
      const newTab = result.current.state.projects[0]!.tabs.find(
        (t) => t.sessionId === 'new-session-id'
      );
      expect(newTab).toBeDefined();
      expect(newTab?.sessionId).toBe('new-session-id');
    });

    it('should update MRU order when switching to existing tab via ADD_TAB', () => {
      const { result } = renderHook(() => useWorkspace());

      // Add a project
      act(() => {
        result.current.addProject('/test/project', 'Test Project');
      });

      const projectPath = '/test/project';
      const firstSessionId = result.current.state.projects[0]!.tabs[0]!.sessionId;

      // Add a second tab
      act(() => {
        result.current.addTab(projectPath, 'second-session-id');
      });

      // Add a third tab
      act(() => {
        result.current.addTab(projectPath, 'third-session-id');
      });

      // Now try to "add" the first tab again (simulating a duplicate scenario)
      act(() => {
        result.current.addTab(projectPath, firstSessionId);
      });

      // Should have exactly 3 tabs (no duplicate)
      expect(result.current.state.projects[0]!.tabs.length).toBe(3);

      // First session should now be at the front of MRU
      const project = result.current.state.projects[0]!;
      expect(project.tabMruOrder?.[0]).toBe(firstSessionId);

      // And it should be active
      expect(result.current.state.projects[0]!.activeTabId).toBe(firstSessionId);
    });
  });

  describe('ADD_TAB basic functionality', () => {
    it('should add a new tab to a project', () => {
      const { result } = renderHook(() => useWorkspace());

      act(() => {
        result.current.addProject('/test/project', 'Test Project');
      });

      const projectPath = '/test/project';
      const initialTabCount = result.current.state.projects[0]!.tabs.length;

      act(() => {
        result.current.addTab(projectPath);
      });

      expect(result.current.state.projects[0]!.tabs.length).toBe(initialTabCount + 1);
    });

    it('should set the new tab as active', () => {
      const { result } = renderHook(() => useWorkspace());

      act(() => {
        result.current.addProject('/test/project', 'Test Project');
      });

      const projectPath = '/test/project';

      act(() => {
        result.current.addTab(projectPath, 'new-tab-session');
      });

      expect(result.current.state.projects[0]!.activeTabId).toBe('new-tab-session');
    });
  });
});
