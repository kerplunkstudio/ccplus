import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeScreen } from './WelcomeScreen';
import { ToastProvider } from '../contexts/ToastContext';

describe('WelcomeScreen', () => {
  const mockOnSelectPrompt = jest.fn();
  const mockOnAddProject = jest.fn();

  beforeEach(() => {
    mockOnSelectPrompt.mockClear();
    mockOnAddProject.mockClear();
  });

  it('renders heading and subtitle', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText('Welcome to cc+')).toBeInTheDocument();
    expect(screen.getByText(/A web UI and observability layer for Claude Code/i)).toBeInTheDocument();
  });

  it('renders feature list', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText('Real-time activity tree')).toBeInTheDocument();
    expect(screen.getByText('Tool usage tracking')).toBeInTheDocument();
    expect(screen.getByText('Multi-project workspaces')).toBeInTheDocument();
  });

  it('renders example prompts', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText('Build a feature')).toBeInTheDocument();
    expect(screen.getByText('Fix a bug')).toBeInTheDocument();
    expect(screen.getByText('Refactor code')).toBeInTheDocument();
    expect(screen.getByText('Write documentation')).toBeInTheDocument();
  });

  it('calls onSelectPrompt when clicking an example prompt', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    const buildFeatureButton = screen.getByText('Build a feature').closest('button');
    fireEvent.click(buildFeatureButton!);

    expect(mockOnSelectPrompt).toHaveBeenCalledTimes(1);
    expect(mockOnSelectPrompt).toHaveBeenCalledWith(
      expect.stringContaining('Create a new REST API endpoint')
    );
  });

  it('shows workspace browse button', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    const browseButton = screen.getByText('Browse for workspace...');
    expect(browseButton).toBeInTheDocument();
  });

  it('renders CTA hint text', () => {
    render(
      <ToastProvider>
        <WelcomeScreen
          onSelectPrompt={mockOnSelectPrompt}
          onAddProject={mockOnAddProject}
        />
      </ToastProvider>
    );

    expect(screen.getByText(/Select a workspace or add a project to start using Claude Code/i)).toBeInTheDocument();
  });
});
