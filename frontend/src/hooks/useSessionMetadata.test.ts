import { renderHook, act, waitFor } from '@testing-library/react';
import { io, Socket } from 'socket.io-client';
import { useSessionMetadata } from './useSessionMetadata';
import { SessionMetadata } from '../types';

// Mock socket.io-client
jest.mock('socket.io-client');

describe('useSessionMetadata', () => {
  let mockSocket: jest.Mocked<Socket>;

  beforeEach(() => {
    // Create a mock socket with event listener methods
    mockSocket = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    } as unknown as jest.Mocked<Socket>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with empty metadata and loading state', () => {
    const { result } = renderHook(() => useSessionMetadata(mockSocket));

    expect(result.current.metadata).toEqual({});
    expect(result.current.isLoading).toBe(true);
  });

  it('should set isLoading to true when socket is null', () => {
    const { result } = renderHook(() => useSessionMetadata(null));

    expect(result.current.isLoading).toBe(true);
  });

  it('should register socket event listeners on mount', () => {
    renderHook(() => useSessionMetadata(mockSocket));

    expect(mockSocket.on).toHaveBeenCalledWith('session:metadata', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('session:updated', expect.any(Function));
  });

  it('should update metadata when session:metadata event is received', () => {
    const { result } = renderHook(() => useSessionMetadata(mockSocket));

    // Get the registered callback for session:metadata
    const metadataCallback = (mockSocket.on as jest.Mock).mock.calls.find(
      (call) => call[0] === 'session:metadata'
    )?.[1];

    expect(metadataCallback).toBeDefined();

    // Simulate receiving metadata
    const metadata: SessionMetadata = { model: 'sonnet', thinking_level: 'medium', verbose: true };
    act(() => {
      metadataCallback(metadata);
    });

    expect(result.current.metadata).toEqual(metadata);
    expect(result.current.isLoading).toBe(false);
  });

  it('should update metadata when session:updated event is received', () => {
    const { result } = renderHook(() => useSessionMetadata(mockSocket));

    // Initialize with some metadata
    const metadataCallback = (mockSocket.on as jest.Mock).mock.calls.find(
      (call) => call[0] === 'session:metadata'
    )?.[1];
    act(() => {
      metadataCallback({ model: 'haiku' });
    });

    // Get the registered callback for session:updated
    const updatedCallback = (mockSocket.on as jest.Mock).mock.calls.find(
      (call) => call[0] === 'session:updated'
    )?.[1];

    expect(updatedCallback).toBeDefined();

    // Simulate receiving updated metadata
    const updatedMetadata: SessionMetadata = { model: 'opus', verbose: false };
    act(() => {
      updatedCallback(updatedMetadata);
    });

    expect(result.current.metadata).toEqual(updatedMetadata);
  });

  it('should unregister socket event listeners on unmount', () => {
    const { unmount } = renderHook(() => useSessionMetadata(mockSocket));

    unmount();

    expect(mockSocket.off).toHaveBeenCalledWith('session:metadata', expect.any(Function));
    expect(mockSocket.off).toHaveBeenCalledWith('session:updated', expect.any(Function));
  });

  it('should emit session:patch when updateMetadata is called', () => {
    const { result } = renderHook(() => useSessionMetadata(mockSocket));

    const patch: Partial<SessionMetadata> = { model: 'opus' };

    act(() => {
      result.current.updateMetadata(patch);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith('session:patch', patch);
  });

  it('should optimistically update local state when updateMetadata is called', () => {
    const { result } = renderHook(() => useSessionMetadata(mockSocket));

    // Initialize with some metadata
    const metadataCallback = (mockSocket.on as jest.Mock).mock.calls.find(
      (call) => call[0] === 'session:metadata'
    )?.[1];
    act(() => {
      metadataCallback({ model: 'haiku', verbose: false });
    });

    // Update metadata
    const patch: Partial<SessionMetadata> = { model: 'opus' };
    act(() => {
      result.current.updateMetadata(patch);
    });

    // Should merge with existing metadata
    expect(result.current.metadata).toEqual({ model: 'opus', verbose: false });
  });

  it('should not emit when updateMetadata is called with null socket', () => {
    const { result } = renderHook(() => useSessionMetadata(null));

    const patch: Partial<SessionMetadata> = { model: 'opus' };

    act(() => {
      result.current.updateMetadata(patch);
    });

    // Should not throw, but also should not emit
    expect(result.current.metadata).toEqual({});
  });

  it('should handle partial metadata updates', () => {
    const { result } = renderHook(() => useSessionMetadata(mockSocket));

    // Initialize with full metadata
    const metadataCallback = (mockSocket.on as jest.Mock).mock.calls.find(
      (call) => call[0] === 'session:metadata'
    )?.[1];
    act(() => {
      metadataCallback({ model: 'haiku', thinking_level: 'high', verbose: true });
    });

    // Update only model
    act(() => {
      result.current.updateMetadata({ model: 'opus' });
    });

    expect(result.current.metadata).toEqual({
      model: 'opus',
      thinking_level: 'high',
      verbose: true,
    });
  });

  it('should handle multiple rapid updates', () => {
    const { result } = renderHook(() => useSessionMetadata(mockSocket));

    act(() => {
      result.current.updateMetadata({ model: 'haiku' });
      result.current.updateMetadata({ thinking_level: 'low' });
      result.current.updateMetadata({ verbose: true });
    });

    expect(result.current.metadata).toEqual({
      model: 'haiku',
      thinking_level: 'low',
      verbose: true,
    });

    expect(mockSocket.emit).toHaveBeenCalledTimes(3);
  });
});
