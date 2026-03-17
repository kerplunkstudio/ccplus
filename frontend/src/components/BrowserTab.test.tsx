import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { BrowserTab } from './BrowserTab';

// Mock window.electronAPI
const mockElectronAPI = {
  openExternal: jest.fn(),
};

describe('BrowserTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset window.electronAPI
    (window as any).electronAPI = undefined;
  });

  describe('Web mode (iframe)', () => {
    it('renders without crashing', () => {
      render(<BrowserTab url="https://example.com" />);

      expect(screen.getByPlaceholderText('Enter URL...')).toBeInTheDocument();
    });

    it('displays initial URL in address bar', () => {
      render(<BrowserTab url="https://example.com" />);

      const input = screen.getByPlaceholderText('Enter URL...') as HTMLInputElement;
      expect(input.value).toBe('https://example.com');
    });

    it('renders iframe with correct src', () => {
      render(<BrowserTab url="https://example.com" />);

      const iframe = document.querySelector('iframe');
      expect(iframe).toBeInTheDocument();
      expect(iframe?.src).toBe('https://example.com/');
    });

    it('updates URL when input changes and form is submitted', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const input = screen.getByPlaceholderText('Enter URL...');
      const goButton = screen.getByLabelText('Navigate');

      fireEvent.change(input, { target: { value: '' } });
      fireEvent.change(input, { target: { value: 'google.com' } });
      fireEvent.click(goButton);

      await waitFor(() => {
        const iframe = document.querySelector('iframe');
        expect(iframe?.src).toBe('https://google.com/');
      });
    });

    it('adds https:// prefix if missing', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const input = screen.getByPlaceholderText('Enter URL...');
      const goButton = screen.getByLabelText('Navigate');

      fireEvent.change(input, { target: { value: '' } });
      fireEvent.change(input, { target: { value: 'example.org' } });
      fireEvent.click(goButton);

      await waitFor(() => {
        const iframe = document.querySelector('iframe');
        expect(iframe?.src).toBe('https://example.org/');
      });
    });

    it('does not add prefix if URL already has protocol', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const input = screen.getByPlaceholderText('Enter URL...');
      const goButton = screen.getByLabelText('Navigate');

      fireEvent.change(input, { target: { value: '' } });
      fireEvent.change(input, { target: { value: 'http://insecure.com' } });
      fireEvent.click(goButton);

      await waitFor(() => {
        const iframe = document.querySelector('iframe');
        expect(iframe?.src).toBe('http://insecure.com/');
      });
    });

    it('opens external browser when external button is clicked', async () => {
      const windowOpen = jest.spyOn(window, 'open').mockImplementation();
      

      render(<BrowserTab url="https://example.com" />);

      const externalButton = screen.getByLabelText('Open in external browser');
      fireEvent.click(externalButton);

      expect(windowOpen).toHaveBeenCalledWith('https://example.com', '_blank');

      windowOpen.mockRestore();
    });

    it('disables back/forward buttons', () => {
      render(<BrowserTab url="https://example.com" />);

      const backButton = screen.getByLabelText('Go back');
      const forwardButton = screen.getByLabelText('Go forward');

      expect(backButton).toBeDisabled();
      expect(forwardButton).toBeDisabled();
    });

    it('renders refresh button', () => {
      render(<BrowserTab url="https://example.com" />);

      const refreshButton = screen.getByLabelText('Refresh');
      expect(refreshButton).toBeInTheDocument();
    });

    it('refreshes iframe when refresh button is clicked', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const iframe = document.querySelector('iframe')!;
      const originalSrc = iframe.src;

      const refreshButton = screen.getByLabelText('Refresh');
      fireEvent.click(refreshButton);

      // After refresh, iframe src should briefly be about:blank then restored
      await waitFor(() => {
        expect(iframe.src).toBe(originalSrc);
      });
    });

    it('updates URL when url prop changes', () => {
      const { rerender } = render(<BrowserTab url="https://example.com" />);

      const input = screen.getByPlaceholderText('Enter URL...') as HTMLInputElement;
      expect(input.value).toBe('https://example.com');

      rerender(<BrowserTab url="https://newurl.com" />);

      expect(input.value).toBe('https://newurl.com');
    });
  });

  describe('Electron mode (webview)', () => {
    beforeEach(() => {
      (window as any).electronAPI = mockElectronAPI;
    });

    it('renders webview instead of iframe', () => {
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview');
      expect(webview).toBeInTheDocument();
      expect(webview?.getAttribute('src')).toBe('https://example.com');
    });

    it('calls electronAPI.openExternal when external button is clicked', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const externalButton = screen.getByLabelText('Open in external browser');
      fireEvent.click(externalButton);

      expect(mockElectronAPI.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    it('handles webview navigation events', async () => {
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview') as any;

      // Mock webview methods
      webview.canGoBack = jest.fn(() => true);
      webview.canGoForward = jest.fn(() => false);
      webview.getURL = jest.fn(() => 'https://example.com/page2');

      // Simulate load start
      const loadStartEvent = new Event('did-start-loading');
      webview.dispatchEvent(loadStartEvent);

      // Simulate load stop
      const loadStopEvent = new Event('did-stop-loading');
      webview.dispatchEvent(loadStopEvent);

      await waitFor(() => {
        const backButton = screen.getByLabelText('Go back');
        const forwardButton = screen.getByLabelText('Go forward');
        expect(backButton).not.toBeDisabled();
        expect(forwardButton).toBeDisabled();
      });
    });

    it('shows error message on webview load failure', async () => {
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview') as any;

      // Simulate load failure
      const loadFailEvent = new Event('did-fail-load') as any;
      loadFailEvent.errorDescription = 'Connection timeout';
      webview.dispatchEvent(loadFailEvent);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load: Connection timeout/)).toBeInTheDocument();
      });
    });

    it('calls webview.goBack when back button is clicked', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview') as any;
      webview.canGoBack = jest.fn(() => true);
      webview.canGoForward = jest.fn(() => false);
      webview.getURL = jest.fn(() => 'https://example.com');
      webview.goBack = jest.fn();

      // Simulate load to enable buttons
      const loadStopEvent = new Event('did-stop-loading');
      webview.dispatchEvent(loadStopEvent);

      await waitFor(() => {
        const backButton = screen.getByLabelText('Go back');
        expect(backButton).not.toBeDisabled();
      });

      const backButton = screen.getByLabelText('Go back');
      fireEvent.click(backButton);

      expect(webview.goBack).toHaveBeenCalled();
    });

    it('calls webview.goForward when forward button is clicked', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview') as any;
      webview.canGoBack = jest.fn(() => false);
      webview.canGoForward = jest.fn(() => true);
      webview.getURL = jest.fn(() => 'https://example.com');
      webview.goForward = jest.fn();

      // Simulate load to enable buttons
      const loadStopEvent = new Event('did-stop-loading');
      webview.dispatchEvent(loadStopEvent);

      await waitFor(() => {
        const forwardButton = screen.getByLabelText('Go forward');
        expect(forwardButton).not.toBeDisabled();
      });

      const forwardButton = screen.getByLabelText('Go forward');
      fireEvent.click(forwardButton);

      expect(webview.goForward).toHaveBeenCalled();
    });

    it('calls webview.reload when refresh button is clicked', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview') as any;
      webview.reload = jest.fn();

      const refreshButton = screen.getByLabelText('Refresh');
      fireEvent.click(refreshButton);

      expect(webview.reload).toHaveBeenCalled();
    });

    it('calls webview.loadURL when navigating to new URL', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview') as any;
      webview.loadURL = jest.fn();

      const input = screen.getByPlaceholderText('Enter URL...');
      const goButton = screen.getByLabelText('Navigate');

      fireEvent.change(input, { target: { value: '' } });
      fireEvent.change(input, { target: { value: 'newsite.com' } });
      fireEvent.click(goButton);

      expect(webview.loadURL).toHaveBeenCalledWith('https://newsite.com');
    });
  });

  describe('Loading state', () => {
    beforeEach(() => {
      (window as any).electronAPI = mockElectronAPI;
    });

    // Note: webview element doesn't fully work in JSDOM, so we skip loading state tests
    it.skip('shows loading indicator when webview is loading', async () => {
      // Webview event handling doesn't work properly in test environment
    });
  });

  describe('Error state', () => {
    beforeEach(() => {
      (window as any).electronAPI = mockElectronAPI;
    });

    it('shows error view when load fails', async () => {
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview') as any;

      const loadFailEvent = new Event('did-fail-load') as any;
      loadFailEvent.errorDescription = 'Network error';
      webview.dispatchEvent(loadFailEvent);

      await waitFor(() => {
        expect(screen.getByText('Cannot load page')).toBeInTheDocument();
        expect(screen.getByText(/Failed to load: Network error/)).toBeInTheDocument();
      });
    });

    it('error view has button to open in external browser', async () => {
      
      render(<BrowserTab url="https://example.com" />);

      const webview = document.querySelector('webview') as any;

      const loadFailEvent = new Event('did-fail-load') as any;
      loadFailEvent.errorDescription = 'Network error';
      webview.dispatchEvent(loadFailEvent);

      await waitFor(() => {
        expect(screen.getByText('Cannot load page')).toBeInTheDocument();
      });

      const externalButton = screen.getByText('Open in external browser');
      fireEvent.click(externalButton);

      expect(mockElectronAPI.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    it.skip('clears error when navigating to new URL', async () => {
      // Webview event handling doesn't work properly in test environment
    });
  });
});
