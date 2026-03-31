import { render, screen, fireEvent, act } from '@testing-library/react';
import { InteractiveCard } from './InteractiveCard';

// Mock useFlyToFleet so we can assert calls without DOM side effects
const mockTriggerFlyToFleet = jest.fn();
jest.mock('../hooks/useFlyToFleet', () => ({
  useFlyToFleet: () => mockTriggerFlyToFleet,
}));

describe('InteractiveCard', () => {
  beforeEach(() => {
    mockTriggerFlyToFleet.mockClear();
  });

  const mockButtons = [
    { label: 'Yes', type: 'primary' as const },
    { label: 'No', type: 'danger' as const },
    { label: 'Maybe', type: 'default' as const }
  ];

  it('renders message and buttons', () => {
    render(
      <InteractiveCard
        message="Do you want to continue?"
        buttons={mockButtons}
        state="pending"
      />
    );

    expect(screen.getByText('Do you want to continue?')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Maybe')).toBeInTheDocument();
  });

  it('calls onSelect when button clicked in pending state', () => {
    const handleSelect = jest.fn();

    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="pending"
        onSelect={handleSelect}
      />
    );

    fireEvent.click(screen.getByText('Yes'));
    expect(handleSelect).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByText('No'));
    expect(handleSelect).toHaveBeenCalledWith(1);
  });

  it('does not call onSelect when buttons clicked in responded state', () => {
    const handleSelect = jest.fn();

    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="responded"
        selectedIndex={0}
        onSelect={handleSelect}
      />
    );

    fireEvent.click(screen.getByText('No'));
    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('disables buttons when state is responded', () => {
    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="responded"
        selectedIndex={0}
      />
    );

    const yesButton = screen.getByText('Yes').closest('button');
    const noButton = screen.getByText('No').closest('button');

    expect(yesButton).toBeDisabled();
    expect(noButton).toBeDisabled();
  });

  it('disables buttons when state is expired', () => {
    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="expired"
      />
    );

    const yesButton = screen.getByText('Yes').closest('button');
    expect(yesButton).toBeDisabled();
  });

  it('shows checkmark on selected button when responded', () => {
    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="responded"
        selectedIndex={1}
      />
    );

    const noButton = screen.getByText('No').closest('button');
    const svg = noButton?.querySelector('svg');

    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '12');
    expect(svg).toHaveAttribute('height', '12');
  });

  it('does not show checkmark on non-selected buttons when responded', () => {
    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="responded"
        selectedIndex={0}
      />
    );

    const noButton = screen.getByText('No').closest('button');
    const svg = noButton?.querySelector('svg');

    expect(svg).not.toBeInTheDocument();
  });

  it('shows expired text when state is expired', () => {
    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="expired"
      />
    );

    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('does not show expired text when state is pending', () => {
    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="pending"
      />
    );

    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('applies correct CSS classes to buttons based on type', () => {
    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="pending"
      />
    );

    const yesButton = screen.getByText('Yes').closest('button');
    const noButton = screen.getByText('No').closest('button');
    const maybeButton = screen.getByText('Maybe').closest('button');

    expect(yesButton).toHaveClass('interactive-card-btn--primary');
    expect(noButton).toHaveClass('interactive-card-btn--danger');
    expect(maybeButton).toHaveClass('interactive-card-btn--default');
  });

  it('applies selected class to selected button in responded state', () => {
    render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="responded"
        selectedIndex={1}
      />
    );

    const noButton = screen.getByText('No').closest('button');
    expect(noButton).toHaveClass('interactive-card-btn--selected');
  });

  // --- Regression tests for fly-to-fleet animation guard (isSessionProposal) ---

  describe('fly-to-fleet animation (isSessionProposal guard)', () => {
    it('does NOT trigger animation when isSessionProposal is false and state changes pending → responded', () => {
      const { rerender } = render(
        <InteractiveCard
          message="Do you want to continue?"
          buttons={mockButtons}
          state="pending"
          isSessionProposal={false}
        />
      );

      act(() => {
        rerender(
          <InteractiveCard
            message="Do you want to continue?"
            buttons={mockButtons}
            state="responded"
            selectedIndex={0}
            isSessionProposal={false}
          />
        );
      });

      expect(mockTriggerFlyToFleet).not.toHaveBeenCalled();
    });

    it('does NOT trigger animation when isSessionProposal is undefined and state changes pending → responded', () => {
      const { rerender } = render(
        <InteractiveCard
          message="Do you want to continue?"
          buttons={mockButtons}
          state="pending"
        />
      );

      act(() => {
        rerender(
          <InteractiveCard
            message="Do you want to continue?"
            buttons={mockButtons}
            state="responded"
            selectedIndex={0}
          />
        );
      });

      expect(mockTriggerFlyToFleet).not.toHaveBeenCalled();
    });

    it('DOES trigger animation when isSessionProposal is true and state changes pending → responded', () => {
      const { rerender } = render(
        <InteractiveCard
          message="Do you want to continue?"
          buttons={mockButtons}
          state="pending"
          isSessionProposal={true}
        />
      );

      act(() => {
        rerender(
          <InteractiveCard
            message="Do you want to continue?"
            buttons={mockButtons}
            state="responded"
            selectedIndex={0}
            isSessionProposal={true}
          />
        );
      });

      expect(mockTriggerFlyToFleet).toHaveBeenCalledTimes(1);
    });

    it('does NOT trigger animation when isSessionProposal is true but state changes responded → expired (not pending → responded)', () => {
      const { rerender } = render(
        <InteractiveCard
          message="Do you want to continue?"
          buttons={mockButtons}
          state="responded"
          selectedIndex={0}
          isSessionProposal={true}
        />
      );

      act(() => {
        rerender(
          <InteractiveCard
            message="Do you want to continue?"
            buttons={mockButtons}
            state="expired"
            isSessionProposal={true}
          />
        );
      });

      // prevState was 'responded' not 'pending', so no animation fires
      expect(mockTriggerFlyToFleet).not.toHaveBeenCalled();
    });

    it('does NOT trigger animation when isSessionProposal is true but state stays pending → pending', () => {
      const { rerender } = render(
        <InteractiveCard
          message="Do you want to continue?"
          buttons={mockButtons}
          state="pending"
          isSessionProposal={true}
        />
      );

      act(() => {
        rerender(
          <InteractiveCard
            message="Do you want to continue?"
            buttons={mockButtons}
            state="pending"
            isSessionProposal={true}
          />
        );
      });

      expect(mockTriggerFlyToFleet).not.toHaveBeenCalled();
    });
  });

  it('applies correct data-state attribute', () => {
    const { container, rerender } = render(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="pending"
      />
    );

    const card = container.querySelector('.interactive-card');
    expect(card).toHaveAttribute('data-state', 'pending');

    rerender(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="responded"
        selectedIndex={0}
      />
    );

    expect(card).toHaveAttribute('data-state', 'responded');

    rerender(
      <InteractiveCard
        message="Choose an option"
        buttons={mockButtons}
        state="expired"
      />
    );

    expect(card).toHaveAttribute('data-state', 'expired');
  });
});
