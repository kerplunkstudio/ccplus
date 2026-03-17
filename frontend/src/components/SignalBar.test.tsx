import React from 'react';
import { render, screen } from '@testing-library/react';
import { SignalBar } from './SignalBar';
import { SignalState } from '../types';

describe('SignalBar', () => {
  it('renders nothing when no status', () => {
    const signals: SignalState = {
      status: null,
    };

    const { container } = render(<SignalBar signals={signals} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when status is null', () => {
    const signals: SignalState = {
      status: null,
    };

    const { container } = render(<SignalBar signals={signals} />);

    expect(container.firstChild).toBeNull();
  });

  describe('phase rendering', () => {
    it('renders planning phase', () => {
      const signals: SignalState = {
        status: {
          phase: 'planning',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Planning')).toBeInTheDocument();
    });

    it('renders implementing phase', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Implementing')).toBeInTheDocument();
    });

    it('renders testing phase', () => {
      const signals: SignalState = {
        status: {
          phase: 'testing',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Testing')).toBeInTheDocument();
    });

    it('renders reviewing phase', () => {
      const signals: SignalState = {
        status: {
          phase: 'reviewing',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Reviewing')).toBeInTheDocument();
    });

    it('renders debugging phase', () => {
      const signals: SignalState = {
        status: {
          phase: 'debugging',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Debugging')).toBeInTheDocument();
    });

    it('renders researching phase', () => {
      const signals: SignalState = {
        status: {
          phase: 'researching',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Researching')).toBeInTheDocument();
    });

    it('renders unknown phase as-is', () => {
      const signals: SignalState = {
        status: {
          phase: 'custom_phase' as 'planning',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('custom_phase')).toBeInTheDocument();
    });
  });

  describe('detail rendering', () => {
    it('renders detail text when provided', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
          detail: 'Writing authentication module',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Writing authentication module')).toBeInTheDocument();
    });

    it('does not render detail when not provided', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      const detailElement = container.querySelector('.signal-phase-detail');
      expect(detailElement).not.toBeInTheDocument();
    });

    it('renders both phase and detail together', () => {
      const signals: SignalState = {
        status: {
          phase: 'testing',
          detail: 'Running unit tests',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Testing')).toBeInTheDocument();
      expect(screen.getByText('Running unit tests')).toBeInTheDocument();
    });
  });

  describe('icons', () => {
    it('renders planning icon', () => {
      const signals: SignalState = {
        status: {
          phase: 'planning',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      const icon = container.querySelector('.signal-phase-icon svg');
      expect(icon).toBeInTheDocument();
    });

    it('renders implementing icon', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      const icon = container.querySelector('.signal-phase-icon svg');
      expect(icon).toBeInTheDocument();
    });

    it('renders testing icon', () => {
      const signals: SignalState = {
        status: {
          phase: 'testing',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      const icon = container.querySelector('.signal-phase-icon svg');
      expect(icon).toBeInTheDocument();
    });

    it('does not render icon for unknown phase', () => {
      const signals: SignalState = {
        status: {
          phase: 'custom_phase' as 'planning',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      const icon = container.querySelector('.signal-phase-icon svg');
      expect(icon).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has role="status"', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      render(<SignalBar signals={signals} />);

      const signalBar = screen.getByRole('status');
      expect(signalBar).toBeInTheDocument();
    });

    it('has aria-label', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      render(<SignalBar signals={signals} />);

      const signalBar = screen.getByRole('status');
      expect(signalBar).toHaveAttribute('aria-label', 'Agent progress');
    });
  });

  describe('CSS classes', () => {
    it('applies signal-bar class', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      expect(container.querySelector('.signal-bar')).toBeInTheDocument();
    });

    it('applies signal-status class', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      expect(container.querySelector('.signal-status')).toBeInTheDocument();
    });

    it('applies signal-phase-label class', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      expect(container.querySelector('.signal-phase-label')).toBeInTheDocument();
    });

    it('applies signal-phase-detail class when detail exists', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
          detail: 'Some detail',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      expect(container.querySelector('.signal-phase-detail')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('handles empty string phase', () => {
      const signals: SignalState = {
        status: {
          phase: '' as 'planning',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      expect(container.querySelector('.signal-bar')).toBeInTheDocument();
    });

    it('handles empty string detail', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
          detail: '',
        },
      };

      const { container } = render(<SignalBar signals={signals} />);

      // Empty detail should not render the detail element
      expect(container.querySelector('.signal-phase-detail')).not.toBeInTheDocument();
    });

    it('handles very long detail text', () => {
      const longDetail = 'A'.repeat(500);
      const signals: SignalState = {
        status: {
          phase: 'implementing',
          detail: longDetail,
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText(longDetail)).toBeInTheDocument();
    });

    it('handles special characters in detail', () => {
      const signals: SignalState = {
        status: {
          phase: 'implementing',
          detail: 'Testing <script>alert("xss")</script> & "quotes"',
        },
      };

      render(<SignalBar signals={signals} />);

      expect(screen.getByText('Testing <script>alert("xss")</script> & "quotes"')).toBeInTheDocument();
    });
  });

  describe('re-rendering', () => {
    it('updates when signals change', () => {
      const initialSignals: SignalState = {
        status: {
          phase: 'planning',
        },
      };

      const { rerender } = render(<SignalBar signals={initialSignals} />);

      expect(screen.getByText('Planning')).toBeInTheDocument();

      const updatedSignals: SignalState = {
        status: {
          phase: 'implementing',
          detail: 'Building feature',
        },
      };

      rerender(<SignalBar signals={updatedSignals} />);

      expect(screen.queryByText('Planning')).not.toBeInTheDocument();
      expect(screen.getByText('Implementing')).toBeInTheDocument();
      expect(screen.getByText('Building feature')).toBeInTheDocument();
    });

    it('removes bar when status becomes null', () => {
      const initialSignals: SignalState = {
        status: {
          phase: 'implementing',
        },
      };

      const { rerender, container } = render(<SignalBar signals={initialSignals} />);

      expect(screen.getByText('Implementing')).toBeInTheDocument();

      const updatedSignals: SignalState = {
        status: null,
      };

      rerender(<SignalBar signals={updatedSignals} />);

      expect(container.firstChild).toBeNull();
    });
  });
});
