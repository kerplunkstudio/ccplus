import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectSidebar from './ProjectSidebar';
import { ProjectEntry } from '../types';
import { ToastProvider } from '../contexts/ToastContext';

const mockProjects: ProjectEntry[] = [
  {
    path: '/path/to/project1',
    name: 'Project 1',
    tabs: [
      {
        sessionId: 'session1',
        label: 'Session One',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
        type: 'chat',
        projectPath: '/path/to/project1',
      },
      {
        sessionId: 'session2',
        label: 'Session Two',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
        type: 'chat',
        projectPath: '/path/to/project1',
      },
    ],
    activeTabId: 'session1',
    tabMruOrder: ['session1', 'session2'],
  },
];

describe('ProjectSidebar - Session Rename', () => {
  const defaultProps = {
    projects: mockProjects,
    activeProjectPath: '/path/to/project1',
    activeTabId: 'session1',
    onSelectProject: jest.fn(),
    onSelectTab: jest.fn(),
    onAddProject: jest.fn(),
    onRemoveProject: jest.fn(),
    onNewTabForProject: jest.fn(),
    onCloseTab: jest.fn(),
    onRenameTab: jest.fn(),
    onOpenSession: jest.fn(),
    sidebarWidth: 260,
    onSidebarWidthChange: jest.fn(),
    onNavigate: jest.fn(),
    activePage: null,
    version: '1.0.0',
  };

  const renderWithToast = (ui: React.ReactElement) => {
    return render(<ToastProvider>{ui}</ToastProvider>);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock localStorage
    Storage.prototype.getItem = jest.fn(() => null);
    Storage.prototype.setItem = jest.fn();
  });

  it('renders sessions without crashing', () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);
    expect(screen.getByText('Project 1')).toBeInTheDocument();
  });

  it('enters edit mode on double-click of active session', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project first
    const projectHeader = screen.getByText('Project 1');
    fireEvent.click(projectHeader);

    // Wait for session to appear
    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeInTheDocument();
    });

    const session = screen.getByText('Session One');

    // Double-click the active session
    userEvent.dblClick(session);

    // Should show input with current label
    await waitFor(() => {
      const input = screen.getByDisplayValue('Session One');
      expect(input).toBeInTheDocument();
      expect(input).toHaveFocus();
    });
  });

  it('commits rename on Enter key', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project
    fireEvent.click(screen.getByText('Project 1'));

    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeInTheDocument();
    });

    const session = screen.getByText('Session One');

    // Double-click to enter edit mode
    userEvent.dblClick(session);

    await waitFor(() => {
      const input = screen.getByDisplayValue('Session One');
      expect(input).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue('Session One');

    // Change the value
    userEvent.clear(input);
    userEvent.type(input, 'Renamed Session');

    // Press Enter
    fireEvent.keyDown(input, { key: 'Enter' });

    // Should call onRenameTab with project path, session ID, and new label
    await waitFor(() => {
      expect(defaultProps.onRenameTab).toHaveBeenCalledWith('/path/to/project1', 'session1', 'Renamed Session');
    });
  });

  it('commits rename on blur', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project
    fireEvent.click(screen.getByText('Project 1'));

    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeInTheDocument();
    });

    const session = screen.getByText('Session One');

    // Double-click to enter edit mode
    userEvent.dblClick(session);

    await waitFor(() => {
      const input = screen.getByDisplayValue('Session One');
      expect(input).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue('Session One');

    // Change the value
    userEvent.clear(input);
    userEvent.type(input, 'New Name');

    // Blur the input
    fireEvent.blur(input);

    // Should call onRenameTab
    await waitFor(() => {
      expect(defaultProps.onRenameTab).toHaveBeenCalledWith('/path/to/project1', 'session1', 'New Name');
    });
  });

  it('cancels rename on Escape key', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project
    fireEvent.click(screen.getByText('Project 1'));

    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeInTheDocument();
    });

    const session = screen.getByText('Session One');

    // Double-click to enter edit mode
    userEvent.dblClick(session);

    await waitFor(() => {
      const input = screen.getByDisplayValue('Session One');
      expect(input).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue('Session One');

    // Change the value
    userEvent.clear(input);
    userEvent.type(input, 'Should Not Save');

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape' });

    // Should not call onRenameTab
    expect(defaultProps.onRenameTab).not.toHaveBeenCalled();

    // Should exit edit mode
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Should Not Save')).not.toBeInTheDocument();
    });
  });

  it('does not enter edit mode on double-click of inactive session', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project
    fireEvent.click(screen.getByText('Project 1'));

    await waitFor(() => {
      expect(screen.getByText('Session Two')).toBeInTheDocument();
    });

    const session = screen.getByText('Session Two');

    // Double-click inactive session
    userEvent.dblClick(session);

    // Should not show rename input (search input is okay, but not Session Two input)
    expect(screen.queryByDisplayValue('Session Two')).not.toBeInTheDocument();
    expect(defaultProps.onSelectTab).toHaveBeenCalled();
  });

  it('does not rename with empty value', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project
    fireEvent.click(screen.getByText('Project 1'));

    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeInTheDocument();
    });

    const session = screen.getByText('Session One');

    // Double-click to enter edit mode
    userEvent.dblClick(session);

    await waitFor(() => {
      const input = screen.getByDisplayValue('Session One');
      expect(input).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue('Session One');

    // Clear the value
    userEvent.clear(input);

    // Press Enter with empty value
    fireEvent.keyDown(input, { key: 'Enter' });

    // Should not call onRenameTab with empty string
    expect(defaultProps.onRenameTab).not.toHaveBeenCalledWith('/path/to/project1', 'session1', '');
  });

  it('trims whitespace from rename value', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project
    fireEvent.click(screen.getByText('Project 1'));

    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeInTheDocument();
    });

    const session = screen.getByText('Session One');

    // Double-click to enter edit mode
    userEvent.dblClick(session);

    await waitFor(() => {
      const input = screen.getByDisplayValue('Session One');
      expect(input).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue('Session One');

    // Change the value with leading/trailing spaces
    userEvent.clear(input);
    userEvent.type(input, '  Trimmed Name  ');

    // Press Enter
    fireEvent.keyDown(input, { key: 'Enter' });

    // Should call onRenameTab with trimmed value
    await waitFor(() => {
      expect(defaultProps.onRenameTab).toHaveBeenCalledWith('/path/to/project1', 'session1', 'Trimmed Name');
    });
  });

  it('auto-selects input text when entering edit mode', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project
    fireEvent.click(screen.getByText('Project 1'));

    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeInTheDocument();
    });

    const session = screen.getByText('Session One');

    // Double-click to enter edit mode
    userEvent.dblClick(session);

    await waitFor(() => {
      const input = screen.getByDisplayValue('Session One') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      // Check that text is selected
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('Session One'.length);
    });
  });

  it('hides close button when in edit mode', async () => {
    renderWithToast(<ProjectSidebar {...defaultProps} />);

    // Expand project
    fireEvent.click(screen.getByText('Project 1'));

    await waitFor(() => {
      expect(screen.getByText('Session One')).toBeInTheDocument();
    });

    const session = screen.getByText('Session One').closest('.sb-session-item');
    expect(session).toBeInTheDocument();

    if (session) {
      // Hover to show close button
      fireEvent.mouseEnter(session);

      await waitFor(() => {
        expect(screen.getByLabelText(/Close Session One/i)).toBeInTheDocument();
      });
    }

    // Double-click to enter edit mode
    userEvent.dblClick(screen.getByText('Session One'));

    // Close button should be hidden during edit
    await waitFor(() => {
      expect(screen.queryByLabelText(/Close Session One/i)).not.toBeInTheDocument();
    });
  });
});
