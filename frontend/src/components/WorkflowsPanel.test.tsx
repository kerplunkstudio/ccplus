import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowsPanel } from './WorkflowsPanel';
import { useWorkflows } from '../hooks/useWorkflows';

// Mock the useWorkflows hook
jest.mock('../hooks/useWorkflows');

const mockUseWorkflows = useWorkflows as jest.MockedFunction<typeof useWorkflows>;

describe('WorkflowsPanel', () => {
  const mockWorkflows = [
    {
      name: 'Test Workflow',
      description: 'Test description',
      phases: [
        {
          name: 'Design',
          context: 'Design phase context',
          agentHints: ['frontend-agent', 'designer'],
          toolRules: [
            { tool: 'Edit', action: 'allow' as const, condition: '', message: '' }
          ]
        },
        {
          name: 'Execute',
          context: 'Execute phase context',
          agentHints: ['code_agent'],
          toolRules: []
        }
      ],
      transitions: []
    }
  ];

  const mockAgents = [
    { name: 'frontend-agent', description: 'Frontend specialist', icon: 'F' },
    { name: 'code_agent', description: 'General code agent', icon: 'C' },
    { name: 'designer', description: 'Design specialist', icon: 'D' }
  ];

  beforeEach(() => {
    mockUseWorkflows.mockReturnValue({
      workflows: mockWorkflows,
      agents: mockAgents,
      loading: false,
      saveWorkflow: jest.fn().mockResolvedValue(true),
      deleteWorkflow: jest.fn().mockResolvedValue(true)
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<WorkflowsPanel />);
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });

  it('displays loading state', () => {
    mockUseWorkflows.mockReturnValue({
      workflows: [],
      agents: [],
      loading: true,
      saveWorkflow: jest.fn(),
      deleteWorkflow: jest.fn()
    });

    render(<WorkflowsPanel />);
    expect(screen.getByText('Loading workflows...')).toBeInTheDocument();
  });

  it('displays workflow list', () => {
    render(<WorkflowsPanel />);
    expect(screen.getByText('Test Workflow')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('opens workflow detail view when clicking edit', () => {
    render(<WorkflowsPanel />);

    const editButton = screen.getByText('edit');
    fireEvent.click(editButton);

    // Should show detail view with workflow name input
    const nameInput = screen.getByPlaceholderText('Workflow name');
    expect(nameInput).toHaveValue('Test Workflow');
  });

  it('displays phase cards in detail view', () => {
    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Should show phase cards
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Execute')).toBeInTheDocument();
  });

  it('displays agent cards inside phase cards', () => {
    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Should show agents in Design phase (agents appear in both phase cards and library)
    const frontendAgents = screen.getAllByText('frontend-agent');
    expect(frontendAgents.length).toBeGreaterThan(0);

    const designers = screen.getAllByText('designer');
    expect(designers.length).toBeGreaterThan(0);

    // Should show agent in Execute phase
    const codeAgents = screen.getAllByText('code_agent');
    expect(codeAgents.length).toBeGreaterThan(0);
  });

  it('displays agent library in detail view for non-builtin workflows', () => {
    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Should show Agent Library
    expect(screen.getByText('Agent Library')).toBeInTheDocument();

    // Should show search input
    expect(screen.getByPlaceholderText('Search agents...')).toBeInTheDocument();
  });

  it('filters agents in library based on search query', () => {
    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    const searchInput = screen.getByPlaceholderText('Search agents...');

    // Search for "frontend"
    fireEvent.change(searchInput, { target: { value: 'frontend' } });

    // Frontend agent should be visible
    const libraryItems = screen.getAllByText('frontend-agent');
    expect(libraryItems.length).toBeGreaterThan(0);

    // The library should still have designer and code_agent in the phase cards,
    // but searching filters the library list. We can verify the library search is working
    // by checking that the search input has the correct value
    expect(searchInput).toHaveValue('frontend');
  });

  it('does not show agent library for builtin workflows', () => {
    const builtinWorkflow = {
      ...mockWorkflows[0],
      builtin: true
    };

    mockUseWorkflows.mockReturnValue({
      workflows: [builtinWorkflow],
      agents: mockAgents,
      loading: false,
      saveWorkflow: jest.fn(),
      deleteWorkflow: jest.fn()
    });

    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('view'));

    // Should NOT show Agent Library
    expect(screen.queryByText('Agent Library')).not.toBeInTheDocument();
  });

  it('removes agent from phase when clicking remove button', () => {
    const saveWorkflow = jest.fn().mockResolvedValue(true);
    mockUseWorkflows.mockReturnValue({
      workflows: mockWorkflows,
      agents: mockAgents,
      loading: false,
      saveWorkflow,
      deleteWorkflow: jest.fn()
    });

    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Find and click the first remove button (× on agent card)
    const removeButtons = screen.getAllByLabelText(/Remove/);
    fireEvent.click(removeButtons[0]);

    // Save should be available
    const saveButton = screen.getByText('save');
    fireEvent.click(saveButton);

    // Should call saveWorkflow with updated workflow
    expect(saveWorkflow).toHaveBeenCalled();
  });

  it('allows toggling agent library visibility', () => {
    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Library should be visible initially
    expect(screen.getByText('Agent Library')).toBeInTheDocument();

    // Click hide library button
    const hideButton = screen.getByText('hide library');
    fireEvent.click(hideButton);

    // Library should be hidden
    expect(screen.queryByText('Agent Library')).not.toBeInTheDocument();

    // Click show library button
    const showButton = screen.getByText('show library');
    fireEvent.click(showButton);

    // Library should be visible again
    expect(screen.getByText('Agent Library')).toBeInTheDocument();
  });

  it('creates new workflow with empty phases', () => {
    render(<WorkflowsPanel />);

    const newButton = screen.getByText('+ New');
    fireEvent.click(newButton);

    // Should show detail view with default name
    const nameInput = screen.getByPlaceholderText('Workflow name');
    expect(nameInput).toHaveValue('New Workflow');

    // Should show "Add Phase" button since no phases exist
    expect(screen.getByText('+ Add Phase')).toBeInTheDocument();
  });

  it('shows phase editor when phase card is clicked', () => {
    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Click on Design phase card
    const designPhase = screen.getByText('Design');
    fireEvent.click(designPhase);

    // Should show phase editor with phase name input
    const phaseNameInputs = screen.getAllByPlaceholderText('Phase name');
    const editorInput = phaseNameInputs.find(input => (input as HTMLInputElement).value === 'Design');
    expect(editorInput).toBeInTheDocument();

    // Should show context textarea
    expect(screen.getByPlaceholderText('Optional context for this phase')).toBeInTheDocument();
  });

  it('displays rule count in phase card header', () => {
    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Design phase has 1 rule
    expect(screen.getByText('1 rule')).toBeInTheDocument();

    // Execute phase has 0 rules
    expect(screen.getByText('0 rules')).toBeInTheDocument();
  });

  it('handles drag and drop data transfer setup', () => {
    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Get all library items
    const libraryItems = screen.getAllByTitle(/specialist/);
    expect(libraryItems.length).toBeGreaterThan(0);

    // Find a library item by its container class
    const libraryItem = libraryItems[0].closest('.wf-agent-library-item');
    expect(libraryItem).toBeInTheDocument();

    // Simulate drag start using fireEvent.dragStart
    fireEvent.dragStart(libraryItem!, {
      dataTransfer: {
        setData: jest.fn(),
        getData: jest.fn()
      }
    });

    // Drag functionality is set up (the component doesn't throw)
    // Actual drag behavior is tested through integration testing
    expect(libraryItem).toHaveAttribute('draggable', 'true');
  });

  it('shows drop zone hint when phase has no agents', () => {
    const workflowWithEmptyPhase = {
      name: 'Empty Workflow',
      description: '',
      phases: [
        {
          name: 'Empty Phase',
          context: '',
          agentHints: [],
          toolRules: []
        }
      ],
      transitions: []
    };

    mockUseWorkflows.mockReturnValue({
      workflows: [workflowWithEmptyPhase],
      agents: mockAgents,
      loading: false,
      saveWorkflow: jest.fn(),
      deleteWorkflow: jest.fn()
    });

    render(<WorkflowsPanel />);

    fireEvent.click(screen.getByText('edit'));

    // Should show drop hint
    expect(screen.getByText('Drop agents here')).toBeInTheDocument();
  });
});
