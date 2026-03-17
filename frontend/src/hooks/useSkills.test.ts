import { renderHook, waitFor, act } from '@testing-library/react';
import { useSkills } from './useSkills';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('useSkills', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('Fetching skills list', () => {
    it('should load skills on mount', async () => {
      const mockSkills = [
        {
          name: 'frontend-patterns',
          plugin: 'core',
          description: 'React component patterns',
        },
        {
          name: 'backend-patterns',
          plugin: 'core',
          description: 'API design patterns',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills }),
      });

      const { result } = renderHook(() => useSkills());

      expect(result.current.loading).toBe(true);
      expect(result.current.skills).toEqual([]);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/api/skills');
      expect(result.current.skills).toHaveLength(2);
      expect(result.current.skills[0]).toEqual({
        name: 'frontend-patterns',
        plugin: 'core',
        description: 'React component patterns',
      });
      expect(result.current.error).toBeNull();
    });

    it('should use default description when skill has no description', async () => {
      const mockSkills = [
        {
          name: 'test-skill',
          plugin: 'test-plugin',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills }),
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.skills[0].description).toBe('From test-plugin');
    });

    it('should handle empty skills array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.skills).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should handle missing skills property', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.skills).toEqual([]);
      expect(result.current.error).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('should handle non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to load skills');
      expect(result.current.skills).toEqual([]);
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.skills).toEqual([]);
    });

    it('should handle unknown error', async () => {
      mockFetch.mockRejectedValueOnce('Unknown error string');

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Unknown error');
      expect(result.current.skills).toEqual([]);
    });

    it('should handle JSON parse error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Invalid JSON');
      expect(result.current.skills).toEqual([]);
    });
  });

  describe('Return shape', () => {
    it('should return correct shape when successful', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current).toHaveProperty('skills');
      expect(result.current).toHaveProperty('loading');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('reload');
      expect(typeof result.current.reload).toBe('function');
    });

    it('should transform skill data correctly', async () => {
      const mockSkills = [
        {
          name: 'skill-one',
          plugin: 'plugin-one',
          description: 'First skill',
          extraField: 'should not appear',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: mockSkills }),
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.skills[0]).toEqual({
        name: 'skill-one',
        plugin: 'plugin-one',
        description: 'First skill',
      });
      expect(result.current.skills[0]).not.toHaveProperty('extraField');
    });
  });

  describe('Loading states', () => {
    it('should start with loading true on mount', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useSkills());

      expect(result.current.loading).toBe(true);
      expect(result.current.skills).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should set loading false after successful fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      const { result } = renderHook(() => useSkills());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should set loading false after failed fetch', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Fetch failed'));

      const { result } = renderHook(() => useSkills());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Reload functionality', () => {
    it('should reload skills when reload is called', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [{ name: 'skill-1', plugin: 'plugin-1' }] }),
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.skills).toHaveLength(1);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [{ name: 'skill-1', plugin: 'plugin-1' }, { name: 'skill-2', plugin: 'plugin-2' }] }),
      });

      act(() => {
        result.current.reload();
      });

      await waitFor(() => {
        expect(result.current.skills).toHaveLength(2);
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should clear error state when reload is called', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Initial error'));

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.error).toBe('Initial error');
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      act(() => {
        result.current.reload();
      });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });

    it('should set loading true during reload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      const { result } = renderHook(() => useSkills());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      act(() => {
        result.current.reload();
      });

      expect(result.current.loading).toBe(true);
    });
  });
});
