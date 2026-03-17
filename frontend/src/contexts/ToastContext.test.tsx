import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ToastProvider, useToast, Toast } from './ToastContext';

// Test component that uses the toast context
const TestComponent: React.FC<{ onToastReady?: (showToast: any, removeToast: any) => void }> = ({ onToastReady }) => {
  const { showToast, toasts, removeToast } = useToast();

  React.useEffect(() => {
    if (onToastReady) {
      onToastReady(showToast, removeToast);
    }
  }, [showToast, removeToast, onToastReady]);

  return (
    <div>
      <div data-testid="toast-count">{toasts.length}</div>
      {toasts.map((toast) => (
        <div key={toast.id} data-testid={`toast-${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
};

describe('ToastContext', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('throws error when useToast is used outside ToastProvider', () => {
    // Suppress console.error for this test
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useToast must be used within ToastProvider');

    jest.restoreAllMocks();
  });

  it('renders children correctly', () => {
    render(
      <ToastProvider>
        <div>Test content</div>
      </ToastProvider>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('adds toast notification with default type (info)', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('Test message');
    });

    expect(screen.getByText('Test message')).toBeInTheDocument();
    expect(screen.getByTestId('toast-info')).toBeInTheDocument();
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
  });

  it('adds toast notification with success type', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('Success message', 'success');
    });

    expect(screen.getByText('Success message')).toBeInTheDocument();
    expect(screen.getByTestId('toast-success')).toBeInTheDocument();
  });

  it('adds toast notification with error type', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('Error message', 'error');
    });

    expect(screen.getByText('Error message')).toBeInTheDocument();
    expect(screen.getByTestId('toast-error')).toBeInTheDocument();
  });

  it('auto-dismisses info toast after 4 seconds', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('Info message', 'info');
    });

    expect(screen.getByText('Info message')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Info message')).not.toBeInTheDocument();
    });
  });

  it('auto-dismisses success toast after 4 seconds', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('Success message', 'success');
    });

    expect(screen.getByText('Success message')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    });
  });

  it('auto-dismisses error toast after 6 seconds', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('Error message', 'error');
    });

    expect(screen.getByText('Error message')).toBeInTheDocument();

    // Should still be visible after 4 seconds
    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(screen.getByText('Error message')).toBeInTheDocument();

    // Should be dismissed after 6 seconds total
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Error message')).not.toBeInTheDocument();
    });
  });

  it('handles multiple toasts simultaneously', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('First message', 'info');
      showToastFn('Second message', 'success');
      showToastFn('Third message', 'error');
    });

    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
    expect(screen.getByText('Third message')).toBeInTheDocument();
    expect(screen.getByTestId('toast-count').textContent).toBe('3');
  });

  it('removes toast manually via removeToast', async () => {
    let showToastFn: any;
    let removeToastFn: any;
    let toastId: string;

    const CaptureIdComponent: React.FC = () => {
      const { showToast, toasts, removeToast } = useToast();

      React.useEffect(() => {
        showToastFn = showToast;
        removeToastFn = removeToast;
      }, [showToast, removeToast]);

      React.useEffect(() => {
        if (toasts.length > 0) {
          toastId = toasts[0].id;
        }
      }, [toasts]);

      return (
        <div>
          {toasts.map((toast) => (
            <div key={toast.id} data-testid="toast">
              {toast.message}
            </div>
          ))}
        </div>
      );
    };

    render(
      <ToastProvider>
        <CaptureIdComponent />
      </ToastProvider>
    );

    act(() => {
      showToastFn('Test message', 'info');
    });

    expect(screen.getByText('Test message')).toBeInTheDocument();

    act(() => {
      removeToastFn(toastId);
    });

    await waitFor(() => {
      expect(screen.queryByText('Test message')).not.toBeInTheDocument();
    });
  });

  it('generates unique IDs for each toast', async () => {
    let showToastFn: any;
    const toastIds: string[] = [];

    const CaptureIdsComponent: React.FC = () => {
      const { showToast, toasts } = useToast();

      React.useEffect(() => {
        showToastFn = showToast;
      }, [showToast]);

      React.useEffect(() => {
        toasts.forEach((toast) => {
          if (!toastIds.includes(toast.id)) {
            toastIds.push(toast.id);
          }
        });
      }, [toasts]);

      return <div />;
    };

    render(
      <ToastProvider>
        <CaptureIdsComponent />
      </ToastProvider>
    );

    act(() => {
      showToastFn('First', 'info');
      showToastFn('Second', 'info');
      showToastFn('Third', 'info');
    });

    expect(toastIds.length).toBe(3);
    expect(new Set(toastIds).size).toBe(3); // All IDs should be unique
  });

  it('maintains toast order (FIFO)', async () => {
    let showToastFn: any;

    const OrderTestComponent: React.FC = () => {
      const { showToast, toasts } = useToast();

      React.useEffect(() => {
        showToastFn = showToast;
      }, [showToast]);

      return (
        <div>
          {toasts.map((toast, index) => (
            <div key={toast.id} data-testid={`toast-${index}`}>
              {toast.message}
            </div>
          ))}
        </div>
      );
    };

    render(
      <ToastProvider>
        <OrderTestComponent />
      </ToastProvider>
    );

    act(() => {
      showToastFn('First', 'info');
      showToastFn('Second', 'info');
      showToastFn('Third', 'info');
    });

    expect(screen.getByTestId('toast-0').textContent).toBe('First');
    expect(screen.getByTestId('toast-1').textContent).toBe('Second');
    expect(screen.getByTestId('toast-2').textContent).toBe('Third');
  });

  it('clears toasts independently based on their timers', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('Info message', 'info');
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    act(() => {
      showToastFn('Error message', 'error');
    });

    // After 4 seconds total, info should be gone
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Info message')).not.toBeInTheDocument();
    });

    // Error should still be visible
    expect(screen.getByText('Error message')).toBeInTheDocument();

    // After 6 more seconds (7 total from error), error should be gone
    act(() => {
      jest.advanceTimersByTime(6000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Error message')).not.toBeInTheDocument();
    });
  });

  it('handles empty message string', async () => {
    let showToastFn: any;

    render(
      <ToastProvider>
        <TestComponent onToastReady={(showToast) => { showToastFn = showToast; }} />
      </ToastProvider>
    );

    act(() => {
      showToastFn('', 'info');
    });

    expect(screen.getByTestId('toast-info')).toBeInTheDocument();
    expect(screen.getByTestId('toast-info').textContent).toBe('');
  });
});
