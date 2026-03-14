import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock the hooks
jest.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: '1', username: 'test' },
    token: 'test-token',
    loading: false,
    logout: jest.fn(),
  }),
}));

jest.mock('./hooks/useTabSocket', () => ({
  useTabSocket: () => ({
    connected: true,
    messages: [],
    streaming: false,
    activityTree: [],
    sendMessage: jest.fn(),
    cancelQuery: jest.fn(),
    toolLogs: [],
    usageStats: {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDuration: 0,
      queryCount: 0,
      contextWindowSize: 200000,
      model: '',
      linesOfCode: 0,
      totalSessions: 0,
    },
  }),
}));

describe('App', () => {
  it('renders the chat panel', () => {
    render(<App />);
    expect(screen.getByText('CC+')).toBeInTheDocument();
  });

  it('renders the activity panel', () => {
    render(<App />);
    // Activity panel now has tabs instead of "Observability" header
    expect(screen.getByText('Agents')).toBeInTheDocument();
  });

  it('renders the two-panel layout', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.app-layout')).toBeInTheDocument();
    expect(container.querySelector('.panel-chat')).toBeInTheDocument();
    expect(container.querySelector('.panel-activity')).toBeInTheDocument();
  });

  it('shows empty state in chat panel', () => {
    render(<App />);
    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
  });

  it('shows empty state in activity panel', () => {
    render(<App />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });
});
