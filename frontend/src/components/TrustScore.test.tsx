import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrustScore } from './TrustScore';
import { TrustMetrics } from '../types';

const mockTrustMetrics: TrustMetrics = {
  overall_score: 85,
  dimensions: {
    test_coverage: 90,
    scope_discipline: 85,
    error_rate: 80,
    cost_efficiency: 85,
    security: 90
  },
  summary: {
    total_tool_calls: 42,
    total_tokens: 15000,
    total_cost_usd: 0.15,
    duration_ms: 120000,
    tests_passed: 8,
    tests_run: 10,
    agents_spawned: 3,
    files_touched: ['src/App.tsx', 'src/components/Panel.tsx'],
    files_created: ['src/new.tsx'],
    files_deleted: []
  },
  flags: [
    {
      severity: 'warning',
      message: 'High token usage',
      detail: 'Consider optimizing prompts'
    }
  ]
};

describe('TrustScore', () => {
  it('renders loading state', () => {
    render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={null}
        loading={true}
        error={null}
      />
    );
    expect(screen.getByText('Analyzing session...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={null}
        loading={false}
        error="Failed to load trust score"
      />
    );
    expect(screen.getByText('Failed to load trust score')).toBeInTheDocument();
  });

  it('renders empty state when no metrics', () => {
    render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={null}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText('No trust metrics available')).toBeInTheDocument();
  });

  it('renders trust metrics with overall score', () => {
    const { container } = render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mockTrustMetrics}
        loading={false}
        error={null}
      />
    );
    const scoreElement = container.querySelector('.trust-overall-score');
    expect(scoreElement).toHaveTextContent('85');
    expect(screen.getByText('trust')).toBeInTheDocument();
  });

  it('renders all dimension bars', () => {
    const { container } = render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mockTrustMetrics}
        loading={false}
        error={null}
      />
    );
    const labels = container.querySelectorAll('.trust-dimension-label');
    const labelTexts = Array.from(labels).map(label => label.textContent);
    expect(labelTexts).toContain('Tests');
    expect(labelTexts).toContain('Scope');
    expect(labelTexts).toContain('Errors');
    expect(labelTexts).toContain('Cost');
    expect(labelTexts).toContain('Security');
  });

  it('renders summary statistics', () => {
    render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mockTrustMetrics}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('15,000')).toBeInTheDocument();
    expect(screen.getByText('$0.1500')).toBeInTheDocument();
    expect(screen.getByText('8 / 10')).toBeInTheDocument();
  });

  it('renders flags when present', () => {
    render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mockTrustMetrics}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText('High token usage')).toBeInTheDocument();
    expect(screen.getByText('Consider optimizing prompts')).toBeInTheDocument();
  });

  it('toggles file sections', () => {
    render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mockTrustMetrics}
        loading={false}
        error={null}
      />
    );

    const touchedButton = screen.getByText(/Files Touched/);
    fireEvent.click(touchedButton);

    expect(screen.getByText('src/App.tsx')).toBeInTheDocument();
    expect(screen.getByText('src/components/Panel.tsx')).toBeInTheDocument();

    fireEvent.click(touchedButton);
    expect(screen.queryByText('src/App.tsx')).not.toBeInTheDocument();
  });

  it('expands files created section', () => {
    render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mockTrustMetrics}
        loading={false}
        error={null}
      />
    );

    const createdButton = screen.getByText(/Files Created/);
    fireEvent.click(createdButton);

    expect(screen.getByText('src/new.tsx')).toBeInTheDocument();
  });

  it('does not render files deleted section when empty', () => {
    render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mockTrustMetrics}
        loading={false}
        error={null}
      />
    );

    expect(screen.queryByText(/Files Deleted/)).not.toBeInTheDocument();
  });

  it('applies correct color for high score', () => {
    const { container } = render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mockTrustMetrics}
        loading={false}
        error={null}
      />
    );

    const scoreElement = container.querySelector('.trust-overall-score');
    expect(scoreElement).toHaveStyle({ color: 'var(--success)' });
  });

  it('applies correct color for medium score', () => {
    const mediumMetrics = {
      ...mockTrustMetrics,
      overall_score: 65
    };

    const { container } = render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={mediumMetrics}
        loading={false}
        error={null}
      />
    );

    const scoreElement = container.querySelector('.trust-overall-score');
    expect(scoreElement).toHaveStyle({ color: 'var(--warning)' });
  });

  it('applies correct color for low score', () => {
    const lowMetrics = {
      ...mockTrustMetrics,
      overall_score: 30
    };

    const { container } = render(
      <TrustScore
        sessionId="test-session"
        trustMetrics={lowMetrics}
        loading={false}
        error={null}
      />
    );

    const scoreElement = container.querySelector('.trust-overall-score');
    expect(scoreElement).toHaveStyle({ color: 'var(--error)' });
  });
});
