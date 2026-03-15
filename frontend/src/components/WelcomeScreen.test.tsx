import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeScreen } from './WelcomeScreen';

describe('WelcomeScreen', () => {
  const mockOnSelectPrompt = jest.fn();
  const mockOnAddProject = jest.fn();

  beforeEach(() => {
    mockOnSelectPrompt.mockClear();
    mockOnAddProject.mockClear();
  });

  it('renders heading and subtitle', () => {
    render(
      <WelcomeScreen
        onSelectPrompt={mockOnSelectPrompt}
        onAddProject={mockOnAddProject}
      />
    );

    expect(screen.getByText('Welcome to cc+')).toBeInTheDocument();
    expect(screen.getByText(/A web UI and observability layer for Claude Code/i)).toBeInTheDocument();
  });

  it('renders feature list', () => {
    render(
      <WelcomeScreen
        onSelectPrompt={mockOnSelectPrompt}
        onAddProject={mockOnAddProject}
      />
    );

    expect(screen.getByText('Real-time activity tree')).toBeInTheDocument();
    expect(screen.getByText('Tool usage tracking')).toBeInTheDocument();
    expect(screen.getByText('Multi-project workspaces')).toBeInTheDocument();
  });

  it('renders example prompts', () => {
    render(
      <WelcomeScreen
        onSelectPrompt={mockOnSelectPrompt}
        onAddProject={mockOnAddProject}
      />
    );

    expect(screen.getByText('Build a feature')).toBeInTheDocument();
    expect(screen.getByText('Fix a bug')).toBeInTheDocument();
    expect(screen.getByText('Refactor code')).toBeInTheDocument();
    expect(screen.getByText('Write documentation')).toBeInTheDocument();
  });

  it('calls onSelectPrompt when clicking an example prompt', () => {
    render(
      <WelcomeScreen
        onSelectPrompt={mockOnSelectPrompt}
        onAddProject={mockOnAddProject}
      />
    );

    const buildFeatureButton = screen.getByText('Build a feature').closest('button');
    fireEvent.click(buildFeatureButton!);

    expect(mockOnSelectPrompt).toHaveBeenCalledTimes(1);
    expect(mockOnSelectPrompt).toHaveBeenCalledWith(
      expect.stringContaining('Create a new REST API endpoint')
    );
  });

  it('calls onAddProject when clicking the CTA button', () => {
    render(
      <WelcomeScreen
        onSelectPrompt={mockOnSelectPrompt}
        onAddProject={mockOnAddProject}
      />
    );

    const addProjectButton = screen.getByText('Add a project').closest('button');
    fireEvent.click(addProjectButton!);

    expect(mockOnAddProject).toHaveBeenCalledTimes(1);
  });

  it('renders CTA hint text', () => {
    render(
      <WelcomeScreen
        onSelectPrompt={mockOnSelectPrompt}
        onAddProject={mockOnAddProject}
      />
    );

    expect(screen.getByText(/Add a project folder to start using Claude Code/i)).toBeInTheDocument();
  });
});
