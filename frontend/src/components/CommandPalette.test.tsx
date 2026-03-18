import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import { ProjectEntry } from '../types/workspace';

const mockProjects: ProjectEntry[] = [
  {
    path: '/workspace/project1',
    name: 'Project One',
    tabs: [
      {
        sessionId: 'session1',
        label: 'Implement auth module',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
        type: 'chat',
      },
      {
        sessionId: 'session2',
        label: 'Fix navigation bug',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
        type: 'chat',
      },
    ],
    activeTabId: 'session1',
    tabMruOrder: ['session1', 'session2'],
  },
  {
    path: '/workspace/project2',
    name: 'Project Two',
    tabs: [
      {
        sessionId: 'session3',
        label: 'Browser Tab',
        isStreaming: false,
        hasRunningAgent: false,
        createdAt: Date.now(),
        type: 'browser',
        url: 'http://localhost:3000',
      },
    ],
    activeTabId: 'session3',
    tabMruOrder: ['session3'],
  },
];

describe('CommandPalette', () => {
  const mockOnClose = jest.fn();
  const mockOnSelectTab = jest.fn();
  const mockOnSelectProject = jest.fn();
  const mockOnNewTab = jest.fn();
  const mockOnCloseTab = jest.fn();
  const mockOnNavigate = jest.fn();
  const mockOnToggleActivityPanel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <CommandPalette
        isOpen={false}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders when open', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );
    expect(screen.getByPlaceholderText(/Search sessions, projects, and actions/i)).toBeInTheDocument();
  });

  it('focuses input when opened', async () => {
    const { rerender } = render(
      <CommandPalette
        isOpen={false}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    rerender(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search sessions, projects, and actions/i)).toHaveFocus();
    });
  });

  it('displays sessions from all projects', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    expect(screen.getByText('Implement auth module')).toBeInTheDocument();
    expect(screen.getByText('Fix navigation bug')).toBeInTheDocument();
    expect(screen.getByText('Browser Tab')).toBeInTheDocument();
  });

  it('displays projects', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    expect(screen.getAllByText('Project One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Project Two').length).toBeGreaterThan(0);
  });

  it('displays action items', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    expect(screen.getByText('New Session')).toBeInTheDocument();
    expect(screen.getByText('Close Tab')).toBeInTheDocument();
    expect(screen.getByText('Open Insights')).toBeInTheDocument();
  });

  it('filters items based on search query', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    const input = screen.getByPlaceholderText(/Search sessions, projects, and actions/i);
    fireEvent.change(input, { target: { value: 'navigation' } });

    // Use getByText with function matcher to handle text split by <mark> elements
    expect(screen.getByText((content, element) => {
      return element?.textContent === 'Fix navigation bug' && element?.classList.contains('command-palette-item-name');
    })).toBeInTheDocument();

    expect(screen.queryByText((content, element) => {
      return element?.textContent === 'Implement auth module' && element?.classList.contains('command-palette-item-name');
    })).not.toBeInTheDocument();
  });

  it('fuzzy matches search queries', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    const input = screen.getByPlaceholderText(/Search sessions, projects, and actions/i);
    fireEvent.change(input, { target: { value: 'ipat' } });

    // Use getByText with function matcher to handle text split by <mark> elements
    expect(screen.getByText((content, element) => {
      return element?.textContent === 'Implement auth module' && element?.classList.contains('command-palette-item-name');
    })).toBeInTheDocument();
  });

  it('shows "No results found" when no items match', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    const input = screen.getByPlaceholderText(/Search sessions, projects, and actions/i);
    fireEvent.change(input, { target: { value: 'zzzzzzzzz' } });

    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('closes palette when clicking overlay', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    const overlay = screen.getByPlaceholderText(/Search sessions, projects, and actions/i).closest('.command-palette-overlay');
    fireEvent.click(overlay!);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside palette', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    const palette = screen.getByPlaceholderText(/Search sessions, projects, and actions/i).closest('.command-palette');
    fireEvent.click(palette!);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('navigates with arrow keys', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    // First item should be selected by default
    const items = screen.getAllByText(/Implement auth module|Fix navigation bug|Browser Tab/i);
    expect(items[0].closest('.command-palette-item')).toHaveClass('selected');

    // Arrow down should select next item
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    const itemsAfterDown = screen.getAllByText(/Implement auth module|Fix navigation bug|Browser Tab/i);
    expect(itemsAfterDown[0].closest('.command-palette-item')).not.toHaveClass('selected');

    // Arrow up should go back
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const itemsAfterUp = screen.getAllByText(/Implement auth module|Fix navigation bug|Browser Tab/i);
    expect(itemsAfterUp[0].closest('.command-palette-item')).toHaveClass('selected');
  });

  it('executes action on Enter key', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    // Filter to a specific action
    const input = screen.getByPlaceholderText(/Search sessions, projects, and actions/i);
    fireEvent.change(input, { target: { value: 'New Session' } });

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(mockOnNewTab).toHaveBeenCalledTimes(1);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('executes session selection on click', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    const sessionItem = screen.getByText('Implement auth module');
    fireEvent.click(sessionItem.closest('.command-palette-item')!);

    expect(mockOnSelectTab).toHaveBeenCalledWith('/workspace/project1', 'session1');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('executes project selection on click', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    // Find the project item by looking for the item with the folder icon and project name
    const projectItems = screen.getAllByText('Project One');
    const projectItem = projectItems.find(el => {
      const parent = el.closest('.command-palette-item');
      return parent?.querySelector('.command-palette-icon')?.textContent === '📁';
    });

    fireEvent.click(projectItem!.closest('.command-palette-item')!);

    expect(mockOnSelectProject).toHaveBeenCalledWith('/workspace/project1');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('limits results to 10 items', () => {
    const manyProjects: ProjectEntry[] = Array.from({ length: 15 }, (_, i) => ({
      path: `/workspace/project${i}`,
      name: `Project ${i}`,
      tabs: [
        {
          sessionId: `session${i}`,
          label: `Session ${i}`,
          isStreaming: false,
          hasRunningAgent: false,
          createdAt: Date.now(),
          type: 'chat' as const,
        },
      ],
      activeTabId: `session${i}`,
      tabMruOrder: [`session${i}`],
    }));

    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={manyProjects}
        activeProjectPath={'/workspace/project0'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    // Should only show 10 items total (excluding category headers)
    const items = document.querySelectorAll('.command-palette-item');
    expect(items.length).toBeLessThanOrEqual(10);
  });

  it('highlights matched characters in search results', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    const input = screen.getByPlaceholderText(/Search sessions, projects, and actions/i);
    fireEvent.change(input, { target: { value: 'navigation' } });

    // Check that matched characters are wrapped in <mark>
    const container = document.querySelector('.command-palette-results');
    expect(container?.querySelector('mark')).toBeInTheDocument();
  });

  it('displays keyboard shortcuts for actions', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        projects={mockProjects}
        activeProjectPath={'/workspace/project1'}
        onSelectTab={mockOnSelectTab}
        onSelectProject={mockOnSelectProject}
        onNewTab={mockOnNewTab}
        onCloseTab={mockOnCloseTab}
        onNavigate={mockOnNavigate}
        onToggleActivityPanel={mockOnToggleActivityPanel}
      />
    );

    const input = screen.getByPlaceholderText(/Search sessions, projects, and actions/i);
    fireEvent.change(input, { target: { value: 'New Session' } });

    expect(screen.getByText('⌘T')).toBeInTheDocument();
  });
});
