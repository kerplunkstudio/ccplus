import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UpdateBanner from './UpdateBanner';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const SOCKET_URL = 'http://localhost:4000';

describe('UpdateBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    // Mock console.debug to avoid cluttering test output
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not render when no update is available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        update_available: false,
        current_version: '1.0.0',
        latest_version: '1.0.0',
        channel: 'stable',
      }),
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`${SOCKET_URL}/api/update-check`);
    });

    expect(screen.queryByText(/cc\+ v/)).not.toBeInTheDocument();
  });

  it('renders update notification when update is available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        update_available: true,
        current_version: '1.0.0',
        latest_version: '1.1.0',
        channel: 'stable',
      }),
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(screen.getByText(/cc\+ v1\.1\.0 is available/)).toBeInTheDocument();
    });

    expect(screen.getByText('./ccplus update')).toBeInTheDocument();
  });

  it('handles dismiss behavior', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        update_available: true,
        current_version: '1.0.0',
        latest_version: '1.1.0',
        channel: 'stable',
      }),
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(screen.getByText(/cc\+ v1\.1\.0 is available/)).toBeInTheDocument();
    });

    const dismissButton = screen.getByLabelText('Dismiss update notification');
    fireEvent.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText(/cc\+ v1\.1\.0 is available/)).not.toBeInTheDocument();
    });

    expect(localStorage.getItem('ccplus_dismissed_update_version')).toBe('1.1.0');
  });

  it('does not render if update was previously dismissed', async () => {
    localStorage.setItem('ccplus_dismissed_update_version', '1.1.0');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        update_available: true,
        current_version: '1.0.0',
        latest_version: '1.1.0',
        channel: 'stable',
      }),
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`${SOCKET_URL}/api/update-check`);
    });

    expect(screen.queryByText(/cc\+ v1\.1\.0 is available/)).not.toBeInTheDocument();
  });

  it('renders if new version is different from dismissed version', async () => {
    localStorage.setItem('ccplus_dismissed_update_version', '1.1.0');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        update_available: true,
        current_version: '1.0.0',
        latest_version: '1.2.0',
        channel: 'stable',
      }),
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(screen.getByText(/cc\+ v1\.2\.0 is available/)).toBeInTheDocument();
    });
  });

  it('silently fails when API call fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`${SOCKET_URL}/api/update-check`);
    });

    expect(screen.queryByText(/cc\+ v/)).not.toBeInTheDocument();
    expect(console.debug).toHaveBeenCalledWith('Failed to check for updates:', expect.any(Error));
  });

  it('silently fails when API returns non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`${SOCKET_URL}/api/update-check`);
    });

    expect(screen.queryByText(/cc\+ v/)).not.toBeInTheDocument();
  });

  it('displays correct version number in notification', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        update_available: true,
        current_version: '2.3.4',
        latest_version: '3.0.0',
        channel: 'stable',
      }),
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(screen.getByText(/cc\+ v3\.0\.0 is available/)).toBeInTheDocument();
    });
  });

  it('displays dismiss button with correct aria-label', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        update_available: true,
        current_version: '1.0.0',
        latest_version: '1.1.0',
        channel: 'stable',
      }),
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(screen.getByLabelText('Dismiss update notification')).toBeInTheDocument();
    });
  });
});
