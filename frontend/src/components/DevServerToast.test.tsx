import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DevServerToast } from './DevServerToast';

describe('DevServerToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders without crashing', () => {
    const onDismiss = jest.fn();
    render(<DevServerToast url="http://localhost:3000" onDismiss={onDismiss} />);
    expect(screen.getByText(/Dev server detected/)).toBeInTheDocument();
  });

  it('displays the URL label correctly', () => {
    const onDismiss = jest.fn();
    render(<DevServerToast url="http://localhost:3000" onDismiss={onDismiss} />);
    expect(screen.getByText('localhost:3000')).toBeInTheDocument();
  });

  it('strips protocol from URL display', () => {
    const onDismiss = jest.fn();
    render(<DevServerToast url="https://example.com:8080" onDismiss={onDismiss} />);
    expect(screen.getByText('example.com:8080')).toBeInTheDocument();
  });

  it('auto-dismisses after 3 seconds', async () => {
    const onDismiss = jest.fn();
    render(<DevServerToast url="http://localhost:3000" onDismiss={onDismiss} />);

    // Fast-forward 3 seconds + fade-out duration
    act(() => {
      jest.advanceTimersByTime(3200);
    });

    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onFocusTab when clicked', () => {
    const onDismiss = jest.fn();
    const onFocusTab = jest.fn();
    render(
      <DevServerToast
        url="http://localhost:3000"
        onDismiss={onDismiss}
        onFocusTab={onFocusTab}
      />
    );

    const toast = screen.getByRole('button');
    fireEvent.click(toast);

    expect(onFocusTab).toHaveBeenCalledTimes(1);
  });

  it('calls onFocusTab when Enter key is pressed', () => {
    const onDismiss = jest.fn();
    const onFocusTab = jest.fn();
    render(
      <DevServerToast
        url="http://localhost:3000"
        onDismiss={onDismiss}
        onFocusTab={onFocusTab}
      />
    );

    const toast = screen.getByRole('button');
    fireEvent.keyDown(toast, { key: 'Enter' });

    expect(onFocusTab).toHaveBeenCalledTimes(1);
  });

  it('does not call onFocusTab if prop is undefined', () => {
    const onDismiss = jest.fn();
    render(<DevServerToast url="http://localhost:3000" onDismiss={onDismiss} />);

    const toast = screen.getByRole('button');
    // Should not throw when clicked
    expect(() => fireEvent.click(toast)).not.toThrow();
  });

  it('shows the rocket icon', () => {
    const onDismiss = jest.fn();
    render(<DevServerToast url="http://localhost:3000" onDismiss={onDismiss} />);
    expect(screen.getByText('🚀')).toBeInTheDocument();
  });

  it('applies visible class after mount', async () => {
    const onDismiss = jest.fn();
    const { container } = render(
      <DevServerToast url="http://localhost:3000" onDismiss={onDismiss} />
    );

    // Trigger requestAnimationFrame
    act(() => {
      jest.runAllTimers();
    });

    await waitFor(() => {
      const toast = container.querySelector('.dev-server-toast');
      expect(toast).toHaveClass('visible');
    });
  });

  it('applies fade-out class before dismissing', async () => {
    const onDismiss = jest.fn();
    const { container } = render(
      <DevServerToast url="http://localhost:3000" onDismiss={onDismiss} />
    );

    // Fast-forward to just before dismiss
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      const toast = container.querySelector('.dev-server-toast');
      expect(toast).toHaveClass('fade-out');
    });
  });
});
