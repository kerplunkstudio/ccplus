import { render, screen } from '@testing-library/react';
import { UsageStatsBar } from './UsageStatsBar';
import { UsageStats } from '../types';

describe('UsageStatsBar', () => {
  const mockStats: UsageStats = {
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDuration: 0,
    queryCount: 0,
    contextWindowSize: 1000000,
    model: 'sonnet',
    linesOfCode: 0,
    totalSessions: 5,
  };

  describe('Non-activity view', () => {
    it('renders session count and model when activity stats are not provided', () => {
      render(<UsageStatsBar stats={mockStats} />);

      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('SESS')).toBeInTheDocument();
      expect(screen.getByText('sonnet')).toBeInTheDocument();
      expect(screen.getByText('MODEL')).toBeInTheDocument();
    });
  });

  describe('Activity view - Context indicator', () => {
    it('renders context usage with percentage when contextTokens is provided', () => {
      const { container } = render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={500000}
        />
      );

      // Component shows 50% because 500000 / 1000000 = 50%
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('CONTEXT')).toBeInTheDocument();

      // Verify the bar width is set correctly
      const fillBar = container.querySelector('.context-bar-fill') as HTMLElement;
      expect(fillBar).toHaveStyle({ width: '50%' });
    });

    it('renders em-dash when contextTokens is null', () => {
      render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={null}
        />
      );

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.getByText('CONTEXT')).toBeInTheDocument();
    });

    it('renders em-dash when contextTokens is undefined', () => {
      render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
        />
      );

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.getByText('CONTEXT')).toBeInTheDocument();
    });

    it('applies neutral color class when context is under 50%', () => {
      const { container } = render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={400000}
        />
      );

      // 400000 / 1000000 = 40%
      const percentage = screen.getByText('40%');
      expect(percentage).not.toHaveClass('context-warn');
      expect(percentage).not.toHaveClass('context-danger');

      const fillBar = container.querySelector('.context-bar-fill');
      expect(fillBar).not.toHaveClass('context-warn');
      expect(fillBar).not.toHaveClass('context-danger');
    });

    it('applies warning color class when context is 50-74%', () => {
      const { container } = render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={700000}
        />
      );

      // 700000 / 1000000 = 70%
      const percentage = screen.getByText('70%');
      expect(percentage).toHaveClass('context-warn');
      expect(percentage).not.toHaveClass('context-danger');

      const fillBar = container.querySelector('.context-bar-fill');
      expect(fillBar).toHaveClass('context-warn');
      expect(fillBar).not.toHaveClass('context-danger');
    });

    it('applies danger color class when context is 75% or above', () => {
      const { container } = render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={800000}
        />
      );

      // 800000 / 1000000 = 80%
      const percentage = screen.getByText('80%');
      expect(percentage).toHaveClass('context-danger');
      expect(percentage).not.toHaveClass('context-warn');

      const fillBar = container.querySelector('.context-bar-fill');
      expect(fillBar).toHaveClass('context-danger');
      expect(fillBar).not.toHaveClass('context-warn');
    });

    it('sets correct bar width based on percentage', () => {
      const { container } = render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={500000}
        />
      );

      // 500000 / 1000000 = 50%
      const fillBar = container.querySelector('.context-bar-fill') as HTMLElement;
      expect(fillBar).toHaveStyle({ width: '50%' });
    });

    it('prioritizes error count over context indicator', () => {
      render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={3}
          hasRunning={false}
          contextTokens={500000}
        />
      );

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('ERRORS')).toBeInTheDocument();
      expect(screen.queryByText('CONTEXT')).not.toBeInTheDocument();
    });

    it('handles context window size of 0 gracefully', () => {
      const statsWithZeroWindow = { ...mockStats, contextWindowSize: 0 };
      render(
        <UsageStatsBar
          stats={statsWithZeroWindow}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={250000}
        />
      );

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.getByText('CONTEXT')).toBeInTheDocument();
    });

    it('rounds percentage to nearest integer', () => {
      render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={123456}
        />
      );

      // 123456 / 1000000 = 0.123456 = 12% (rounded)
      expect(screen.getByText('12%')).toBeInTheDocument();
    });

    it('handles 100% context usage', () => {
      const { container } = render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={10}
          elapsed="5m 30s"
          errorCount={0}
          hasRunning={false}
          contextTokens={1000000}
        />
      );

      // 1000000 / 1000000 = 100%
      expect(screen.getByText('100%')).toBeInTheDocument();

      const fillBar = container.querySelector('.context-bar-fill') as HTMLElement;
      expect(fillBar).toHaveStyle({ width: '100%' });
      expect(fillBar).toHaveClass('context-danger');
    });

    it('renders tools and elapsed time columns', () => {
      render(
        <UsageStatsBar
          stats={mockStats}
          totalTools={15}
          elapsed="3m 45s"
          errorCount={0}
          hasRunning={false}
          contextTokens={500000}
        />
      );

      expect(screen.getByText('15')).toBeInTheDocument();
      expect(screen.getByText('TOOLS')).toBeInTheDocument();
      expect(screen.getByText('3m 45s')).toBeInTheDocument();
      expect(screen.getByText('ELAPSED')).toBeInTheDocument();
    });
  });
});
