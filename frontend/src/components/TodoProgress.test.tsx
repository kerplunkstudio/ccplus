import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { TodoProgress } from './TodoProgress';
import { TodoItem } from '../types';

describe('TodoProgress', () => {
  const mockOnDismiss = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('renders nothing when todos array is empty', () => {
    const { container } = render(<TodoProgress todos={[]} onDismiss={mockOnDismiss} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders todo items with correct status icons', () => {
    const todos: TodoItem[] = [
      { content: 'Task 1', status: 'pending', activeForm: '' },
      { content: 'Task 2', status: 'in_progress', activeForm: 'Working on Task 2' },
      { content: 'Task 3', status: 'completed', activeForm: '' },
    ];

    render(<TodoProgress todos={todos} onDismiss={mockOnDismiss} />);

    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Working on Task 2')).toBeInTheDocument();
    expect(screen.getByText('Task 3')).toBeInTheDocument();

    // Check status icons
    const items = screen.getAllByText(/○|→|✓/);
    expect(items).toHaveLength(3);
  });

  it('displays correct counter', () => {
    const todos: TodoItem[] = [
      { content: 'Task 1', status: 'completed', activeForm: '' },
      { content: 'Task 2', status: 'in_progress', activeForm: 'Working' },
      { content: 'Task 3', status: 'pending', activeForm: '' },
    ];

    render(<TodoProgress todos={todos} onDismiss={mockOnDismiss} />);
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('shows activeForm for in_progress items', () => {
    const todos: TodoItem[] = [
      { content: 'Original task', status: 'in_progress', activeForm: 'Custom active form text' },
    ];

    render(<TodoProgress todos={todos} onDismiss={mockOnDismiss} />);
    expect(screen.getByText('Custom active form text')).toBeInTheDocument();
    expect(screen.queryByText('Original task')).not.toBeInTheDocument();
  });

  it('auto-dismisses after all tasks complete', () => {
    const allCompleteTodos: TodoItem[] = [
      { content: 'Task 1', status: 'completed', activeForm: '' },
      { content: 'Task 2', status: 'completed', activeForm: '' },
    ];

    render(<TodoProgress todos={allCompleteTodos} onDismiss={mockOnDismiss} />);

    // Should hold for 1500ms before starting dismiss
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    // Then fade out for 500ms
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not auto-dismiss when tasks are incomplete', () => {
    const incompleteTodos: TodoItem[] = [
      { content: 'Task 1', status: 'completed', activeForm: '' },
      { content: 'Task 2', status: 'in_progress', activeForm: 'Working' },
    ];

    render(<TodoProgress todos={incompleteTodos} onDismiss={mockOnDismiss} />);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockOnDismiss).not.toHaveBeenCalled();
  });

  it('applies complete styling when all tasks are done', () => {
    const allCompleteTodos: TodoItem[] = [
      { content: 'Task 1', status: 'completed', activeForm: '' },
    ];

    const { container } = render(<TodoProgress todos={allCompleteTodos} onDismiss={mockOnDismiss} />);
    const progressElement = container.querySelector('.todo-progress');
    expect(progressElement).toHaveClass('todo-progress--complete');
  });

  it('applies dismissing styling during fade out', () => {
    const allCompleteTodos: TodoItem[] = [
      { content: 'Task 1', status: 'completed', activeForm: '' },
    ];

    const { container } = render(<TodoProgress todos={allCompleteTodos} onDismiss={mockOnDismiss} />);

    // Wait for hold duration
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    const progressElement = container.querySelector('.todo-progress');
    expect(progressElement).toHaveClass('todo-progress--dismissing');
  });

  it('cleans up timer on unmount', () => {
    const allCompleteTodos: TodoItem[] = [
      { content: 'Task 1', status: 'completed', activeForm: '' },
    ];

    const { unmount } = render(<TodoProgress todos={allCompleteTodos} onDismiss={mockOnDismiss} />);

    unmount();

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockOnDismiss).not.toHaveBeenCalled();
  });
});
