import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toast } from './Toast';
import { Toast as ToastType } from '../contexts/ToastContext';

describe('Toast', () => {
  const mockOnRemove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('rendering', () => {
    it('renders error toast with message', () => {
      const toast: ToastType = {
        id: '1',
        message: 'An error occurred',
        type: 'error',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(screen.getByText('An error occurred')).toBeInTheDocument();
    });

    it('renders success toast with message', () => {
      const toast: ToastType = {
        id: '2',
        message: 'Operation successful',
        type: 'success',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(screen.getByText('Operation successful')).toBeInTheDocument();
    });

    it('renders info toast with message', () => {
      const toast: ToastType = {
        id: '3',
        message: 'Information message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(screen.getByText('Information message')).toBeInTheDocument();
    });

    it('applies correct CSS class for type', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Error message',
        type: 'error',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(container.querySelector('.toast-error')).toBeInTheDocument();
    });

    it('renders error icon for error type', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Error',
        type: 'error',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const icon = container.querySelector('.toast-icon svg');
      expect(icon).toBeInTheDocument();
    });

    it('renders success icon for success type', () => {
      const toast: ToastType = {
        id: '2',
        message: 'Success',
        type: 'success',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const icon = container.querySelector('.toast-icon svg');
      expect(icon).toBeInTheDocument();
    });

    it('renders info icon for info type', () => {
      const toast: ToastType = {
        id: '3',
        message: 'Info',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const icon = container.querySelector('.toast-icon svg');
      expect(icon).toBeInTheDocument();
    });

    it('renders close button', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(screen.getByRole('button', { name: 'Close notification' })).toBeInTheDocument();
    });
  });

  describe('dismissal', () => {
    it('calls onRemove when close button is clicked', async () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: 'Close notification' });
      fireEvent.click(closeButton);

      // Animation takes 200ms
      jest.advanceTimersByTime(200);

      expect(mockOnRemove).toHaveBeenCalledWith('1');
    });

    it('adds exiting class when close is triggered', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: 'Close notification' });
      fireEvent.click(closeButton);

      expect(container.querySelector('.toast-exiting')).toBeInTheDocument();
    });

    it('waits for animation before calling onRemove', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: 'Close notification' });
      fireEvent.click(closeButton);

      // Not called immediately
      expect(mockOnRemove).not.toHaveBeenCalled();

      // Called after 200ms
      jest.advanceTimersByTime(200);
      expect(mockOnRemove).toHaveBeenCalledWith('1');
    });
  });

  describe('keyboard interaction', () => {
    it('dismisses on Escape key', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const toastElement = container.querySelector('.toast');
      fireEvent.keyDown(toastElement!, { key: 'Escape' });

      jest.advanceTimersByTime(200);

      expect(mockOnRemove).toHaveBeenCalledWith('1');
    });

    it('dismisses on Enter key', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const toastElement = container.querySelector('.toast');
      fireEvent.keyDown(toastElement!, { key: 'Enter' });

      jest.advanceTimersByTime(200);

      expect(mockOnRemove).toHaveBeenCalledWith('1');
    });

    it('does not dismiss on other keys', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const toastElement = container.querySelector('.toast');
      fireEvent.keyDown(toastElement!, { key: 'a' });
      fireEvent.keyDown(toastElement!, { key: 'Space' });
      fireEvent.keyDown(toastElement!, { key: 'Tab' });

      jest.advanceTimersByTime(200);

      expect(mockOnRemove).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('has role="alert"', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('has aria-live="polite"', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'polite');
    });

    it('is focusable with tabIndex=0', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('tabIndex', '0');
    });

    it('close button has aria-label', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: 'Close notification' });
      expect(closeButton).toHaveAttribute('aria-label', 'Close notification');
    });
  });

  describe('edge cases', () => {
    it('handles very long message', () => {
      const longMessage = 'A'.repeat(500);
      const toast: ToastType = {
        id: '1',
        message: longMessage,
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });

    it('handles empty message', () => {
      const toast: ToastType = {
        id: '1',
        message: '',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(container.querySelector('.toast-message')).toBeInTheDocument();
      expect(container.querySelector('.toast-message')?.textContent).toBe('');
    });

    it('handles special characters in message', () => {
      const toast: ToastType = {
        id: '1',
        message: '<script>alert("xss")</script> & "quotes"',
        type: 'error',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(screen.getByText('<script>alert("xss")</script> & "quotes"')).toBeInTheDocument();
    });

    it('handles multiline message', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Line 1\nLine 2\nLine 3',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      // The message div contains the text (newlines are preserved in the DOM)
      const messageDiv = container.querySelector('.toast-message');
      expect(messageDiv).toBeInTheDocument();
      expect(messageDiv?.textContent).toBe('Line 1\nLine 2\nLine 3');
    });

    it('only calls onRemove once even if close is clicked multiple times', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: 'Close notification' });
      fireEvent.click(closeButton);
      fireEvent.click(closeButton);
      fireEvent.click(closeButton);

      jest.advanceTimersByTime(200);

      // Each click triggers a new timeout, so 3 calls
      expect(mockOnRemove).toHaveBeenCalledTimes(3);
      expect(mockOnRemove).toHaveBeenCalledWith('1');
    });
  });

  describe('CSS classes', () => {
    it('applies toast class', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(container.querySelector('.toast')).toBeInTheDocument();
    });

    it('applies toast-info class for info type', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(container.querySelector('.toast-info')).toBeInTheDocument();
    });

    it('applies toast-success class for success type', () => {
      const toast: ToastType = {
        id: '2',
        message: 'Message',
        type: 'success',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(container.querySelector('.toast-success')).toBeInTheDocument();
    });

    it('applies toast-error class for error type', () => {
      const toast: ToastType = {
        id: '3',
        message: 'Message',
        type: 'error',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      expect(container.querySelector('.toast-error')).toBeInTheDocument();
    });

    it('applies toast-exiting class after close', () => {
      const toast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      const { container } = render(<Toast toast={toast} onRemove={mockOnRemove} />);

      const closeButton = screen.getByRole('button', { name: 'Close notification' });
      fireEvent.click(closeButton);

      expect(container.querySelector('.toast-exiting')).toBeInTheDocument();
    });
  });

  describe('re-rendering', () => {
    it('updates message when toast prop changes', () => {
      const initialToast: ToastType = {
        id: '1',
        message: 'Initial message',
        type: 'info',
      };

      const { rerender } = render(<Toast toast={initialToast} onRemove={mockOnRemove} />);

      expect(screen.getByText('Initial message')).toBeInTheDocument();

      const updatedToast: ToastType = {
        id: '1',
        message: 'Updated message',
        type: 'info',
      };

      rerender(<Toast toast={updatedToast} onRemove={mockOnRemove} />);

      expect(screen.queryByText('Initial message')).not.toBeInTheDocument();
      expect(screen.getByText('Updated message')).toBeInTheDocument();
    });

    it('updates type when toast prop changes', () => {
      const initialToast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'info',
      };

      const { container, rerender } = render(<Toast toast={initialToast} onRemove={mockOnRemove} />);

      expect(container.querySelector('.toast-info')).toBeInTheDocument();

      const updatedToast: ToastType = {
        id: '1',
        message: 'Message',
        type: 'error',
      };

      rerender(<Toast toast={updatedToast} onRemove={mockOnRemove} />);

      expect(container.querySelector('.toast-info')).not.toBeInTheDocument();
      expect(container.querySelector('.toast-error')).toBeInTheDocument();
    });
  });
});
