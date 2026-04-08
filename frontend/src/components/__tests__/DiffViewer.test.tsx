import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffViewer } from '../DiffViewer';
import * as useDiffModule from '../../hooks/useDiff';
import type { DiffResult } from '../../hooks/useDiff';

jest.mock('../../hooks/useDiff');

describe('DiffViewer', () => {
  const mockUseDiff = useDiffModule.useDiff as jest.MockedFunction<typeof useDiffModule.useDiff>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock scrollIntoView as it's not available in jsdom
    Element.prototype.scrollIntoView = jest.fn();
  });

  it('renders loading state', () => {
    mockUseDiff.mockReturnValue({
      diffResult: null,
      loading: true,
      error: null,
      selectedFile: null,
      fetchDiff: jest.fn(),
      selectFile: jest.fn(),
    });

    render(<DiffViewer sessionId="test-session" />);

    expect(screen.getByText('Analyzing changes…')).toBeInTheDocument();
  });

  it('renders loading state skeleton rows', () => {
    mockUseDiff.mockReturnValue({
      diffResult: null,
      loading: true,
      error: null,
      selectedFile: null,
      fetchDiff: jest.fn(),
      selectFile: jest.fn(),
    });

    const { container } = render(<DiffViewer sessionId="test-session" />);

    expect(container.querySelector('.diff-state-skeleton')).toBeInTheDocument();
    expect(container.querySelectorAll('.diff-skeleton-row')).toHaveLength(4);
  });

  it('renders error state with context message', () => {
    mockUseDiff.mockReturnValue({
      diffResult: null,
      loading: false,
      error: 'Failed to fetch diff',
      selectedFile: null,
      fetchDiff: jest.fn(),
      selectFile: jest.fn(),
    });

    render(<DiffViewer sessionId="test-session" />);

    expect(screen.getByText('Could not load the diff for this session.')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch diff')).toBeInTheDocument();
  });

  it('renders error state retry button that calls fetchDiff', () => {
    const mockFetchDiff = jest.fn();
    mockUseDiff.mockReturnValue({
      diffResult: null,
      loading: false,
      error: 'Network error',
      selectedFile: null,
      fetchDiff: mockFetchDiff,
      selectFile: jest.fn(),
    });

    render(<DiffViewer sessionId="test-session" />);

    const retryButton = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);

    expect(mockFetchDiff).toHaveBeenCalledTimes(2); // once on mount, once on retry
  });

  it('renders empty state when no files changed', () => {
    const emptyDiffResult: DiffResult = {
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
    };

    mockUseDiff.mockReturnValue({
      diffResult: emptyDiffResult,
      loading: false,
      error: null,
      selectedFile: null,
      fetchDiff: jest.fn(),
      selectFile: jest.fn(),
    });

    render(<DiffViewer sessionId="test-session" />);

    expect(screen.getByText('No changes detected')).toBeInTheDocument();
    expect(screen.getByText(/This session may not have modified any files/)).toBeInTheDocument();
  });

  it('renders empty state refresh button that calls fetchDiff', () => {
    const mockFetchDiff = jest.fn();
    const emptyDiffResult: DiffResult = {
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
    };

    mockUseDiff.mockReturnValue({
      diffResult: emptyDiffResult,
      loading: false,
      error: null,
      selectedFile: null,
      fetchDiff: mockFetchDiff,
      selectFile: jest.fn(),
    });

    render(<DiffViewer sessionId="test-session" />);

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refreshButton);

    expect(mockFetchDiff).toHaveBeenCalledTimes(2); // once on mount, once on refresh
  });

  it('renders file sidebar with files', () => {
    const mockDiffResult: DiffResult = {
      files: [
        {
          path: 'src/components/Test.tsx',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
        },
        {
          path: 'src/utils/helper.ts',
          status: 'added',
          additions: 20,
          deletions: 0,
          hunks: [],
        },
      ],
      totalAdditions: 30,
      totalDeletions: 5,
    };

    mockUseDiff.mockReturnValue({
      diffResult: mockDiffResult,
      loading: false,
      error: null,
      selectedFile: 'src/components/Test.tsx',
      fetchDiff: jest.fn(),
      selectFile: jest.fn(),
    });

    render(<DiffViewer sessionId="test-session" />);

    expect(screen.getByText('2 files changed')).toBeInTheDocument();
    expect(screen.getByText('…/components/Test.tsx')).toBeInTheDocument();
    expect(screen.getByText('…/utils/helper.ts')).toBeInTheDocument();
  });

  it('shows addition and deletion counts in sidebar', () => {
    const mockDiffResult: DiffResult = {
      files: [
        {
          path: 'src/test.ts',
          status: 'modified',
          additions: 15,
          deletions: 8,
          hunks: [],
        },
      ],
      totalAdditions: 15,
      totalDeletions: 8,
    };

    mockUseDiff.mockReturnValue({
      diffResult: mockDiffResult,
      loading: false,
      error: null,
      selectedFile: 'src/test.ts',
      fetchDiff: jest.fn(),
      selectFile: jest.fn(),
    });

    const { container } = render(<DiffViewer sessionId="test-session" />);

    const sidebarCounts = container.querySelector('.diff-sidebar-item-counts');
    expect(sidebarCounts).toBeInTheDocument();
    expect(sidebarCounts?.textContent).toContain('+15');
    expect(sidebarCounts?.textContent).toContain('-8');
  });

  it('shows total additions and deletions', () => {
    const mockDiffResult: DiffResult = {
      files: [
        {
          path: 'src/file1.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [],
        },
        {
          path: 'src/file2.ts',
          status: 'added',
          additions: 20,
          deletions: 0,
          hunks: [],
        },
      ],
      totalAdditions: 30,
      totalDeletions: 5,
    };

    mockUseDiff.mockReturnValue({
      diffResult: mockDiffResult,
      loading: false,
      error: null,
      selectedFile: null,
      fetchDiff: jest.fn(),
      selectFile: jest.fn(),
    });

    const { container } = render(<DiffViewer sessionId="test-session" />);

    const summarySection = container.querySelector('.diff-summary');
    expect(summarySection).toBeInTheDocument();
    expect(summarySection?.textContent).toContain('+30');
    expect(summarySection?.textContent).toContain('-5');
  });

  it('renders diff lines with correct classes', () => {
    const mockDiffResult: DiffResult = {
      files: [
        {
          path: 'src/test.ts',
          status: 'modified',
          additions: 2,
          deletions: 1,
          hunks: [
            {
              header: '@@ -1,3 +1,4 @@',
              oldStart: 1,
              oldCount: 3,
              newStart: 1,
              newCount: 4,
              lines: [
                { type: 'context', content: 'const x = 1;', oldLineNumber: 1, newLineNumber: 1 },
                { type: 'addition', content: 'const y = 2;', oldLineNumber: null, newLineNumber: 2 },
                { type: 'deletion', content: 'const z = 3;', oldLineNumber: 2, newLineNumber: null },
              ],
            },
          ],
        },
      ],
      totalAdditions: 2,
      totalDeletions: 1,
    };

    mockUseDiff.mockReturnValue({
      diffResult: mockDiffResult,
      loading: false,
      error: null,
      selectedFile: 'src/test.ts',
      fetchDiff: jest.fn(),
      selectFile: jest.fn(),
    });

    const { container } = render(<DiffViewer sessionId="test-session" />);

    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByText('const y = 2;')).toBeInTheDocument();
    expect(screen.getByText('const z = 3;')).toBeInTheDocument();

    const additionLine = container.querySelector('.diff-line--addition');
    const deletionLine = container.querySelector('.diff-line--deletion');
    const contextLine = container.querySelector('.diff-line--context');

    expect(additionLine).toBeInTheDocument();
    expect(deletionLine).toBeInTheDocument();
    expect(contextLine).toBeInTheDocument();
  });

  it('calls selectFile when clicking file in sidebar', () => {
    const mockSelectFile = jest.fn();
    const mockDiffResult: DiffResult = {
      files: [
        {
          path: 'src/file1.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          hunks: [],
        },
        {
          path: 'src/file2.ts',
          status: 'added',
          additions: 10,
          deletions: 0,
          hunks: [],
        },
      ],
      totalAdditions: 15,
      totalDeletions: 2,
    };

    mockUseDiff.mockReturnValue({
      diffResult: mockDiffResult,
      loading: false,
      error: null,
      selectedFile: 'src/file1.ts',
      fetchDiff: jest.fn(),
      selectFile: mockSelectFile,
    });

    const { container } = render(<DiffViewer sessionId="test-session" />);

    const sidebarItems = container.querySelectorAll('.diff-sidebar-item');
    fireEvent.click(sidebarItems[1]); // Click second file

    expect(mockSelectFile).toHaveBeenCalledWith('src/file2.ts');
  });

  it('calls fetchDiff on mount', () => {
    const mockFetchDiff = jest.fn();

    mockUseDiff.mockReturnValue({
      diffResult: null,
      loading: false,
      error: null,
      selectedFile: null,
      fetchDiff: mockFetchDiff,
      selectFile: jest.fn(),
    });

    render(<DiffViewer sessionId="test-session" />);

    expect(mockFetchDiff).toHaveBeenCalled();
  });
});
