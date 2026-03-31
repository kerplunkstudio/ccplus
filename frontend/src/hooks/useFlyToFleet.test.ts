import { renderHook } from '@testing-library/react';
import { useFlyToFleet } from './useFlyToFleet';

describe('useFlyToFleet', () => {
  beforeEach(() => {
    // Clear DOM
    document.body.innerHTML = '';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('returns a trigger function', () => {
    const { result } = renderHook(() => useFlyToFleet());
    expect(typeof result.current).toBe('function');
  });

  it('does nothing when source element is null', () => {
    const { result } = renderHook(() => useFlyToFleet());
    const trigger = result.current;

    // Should not throw
    expect(() => trigger(null)).not.toThrow();
  });

  it('fades out source when fleet panel is not found', () => {
    const sourceElement = document.createElement('div');
    document.body.appendChild(sourceElement);

    const { result } = renderHook(() => useFlyToFleet());
    const trigger = result.current;

    trigger(sourceElement);

    // Transition is set synchronously before the requestAnimationFrame callbacks
    expect(sourceElement.style.transition).toContain('opacity');

    // Flush nested requestAnimationFrame callbacks.
    // Jest fakes rAF as setTimeout(fn, 1000/60) ≈ 16ms per frame.
    // The hook uses two nested rAF calls, so advance 50ms to fire both frames.
    jest.advanceTimersByTime(50);

    expect(sourceElement.style.opacity).toBe('0');
  });

  it('creates animated clone when fleet panel exists', () => {
    // Create source element
    const sourceElement = document.createElement('div');
    sourceElement.getBoundingClientRect = jest.fn(() => ({
      top: 100,
      left: 100,
      width: 200,
      height: 50,
      right: 300,
      bottom: 150,
      x: 100,
      y: 100,
      toJSON: () => ({})
    }));
    document.body.appendChild(sourceElement);

    // Create fleet panel — must match .captain-panel[data-fleet-panel]
    const fleetPanel = document.createElement('div');
    fleetPanel.className = 'captain-panel';
    fleetPanel.dataset.fleetPanel = 'true';
    fleetPanel.getBoundingClientRect = jest.fn(() => ({
      top: 500,
      left: 600,
      width: 400,
      height: 600,
      right: 1000,
      bottom: 1100,
      x: 600,
      y: 500,
      toJSON: () => ({})
    }));
    document.body.appendChild(fleetPanel);

    const { result } = renderHook(() => useFlyToFleet({ duration: 600 }));
    const trigger = result.current;

    trigger(sourceElement);

    // Source should be hidden
    expect(sourceElement.style.opacity).toBe('0');

    // Clone should be created
    const clones = document.querySelectorAll('[style*="position: fixed"]');
    expect(clones.length).toBeGreaterThan(0);

    const clone = clones[0] as HTMLElement;
    expect(clone.style.position).toBe('fixed');
    expect(clone.style.zIndex).toBe('10000');
  });

  it('triggers fleet panel pulse after animation completes', () => {
    const sourceElement = document.createElement('div');
    sourceElement.getBoundingClientRect = jest.fn(() => ({
      top: 100,
      left: 100,
      width: 200,
      height: 50,
      right: 300,
      bottom: 150,
      x: 100,
      y: 100,
      toJSON: () => ({})
    }));
    document.body.appendChild(sourceElement);

    const fleetPanel = document.createElement('div');
    fleetPanel.className = 'captain-panel';
    fleetPanel.dataset.fleetPanel = 'true';
    fleetPanel.getBoundingClientRect = jest.fn(() => ({
      top: 500,
      left: 600,
      width: 400,
      height: 600,
      right: 1000,
      bottom: 1100,
      x: 600,
      y: 500,
      toJSON: () => ({})
    }));
    document.body.appendChild(fleetPanel);

    const { result } = renderHook(() => useFlyToFleet({ duration: 600 }));
    const trigger = result.current;

    trigger(sourceElement);

    // Fast-forward through animation
    jest.advanceTimersByTime(600);

    // Fleet panel should have pulse class
    expect(fleetPanel.classList.contains('fleet-panel-pulse')).toBe(true);

    // Fast-forward through pulse animation (800ms to match hook's setTimeout duration)
    jest.advanceTimersByTime(800);

    // Pulse class should be removed
    expect(fleetPanel.classList.contains('fleet-panel-pulse')).toBe(false);
  });

  it('calls onComplete callback after animation', () => {
    const sourceElement = document.createElement('div');
    sourceElement.getBoundingClientRect = jest.fn(() => ({
      top: 100,
      left: 100,
      width: 200,
      height: 50,
      right: 300,
      bottom: 150,
      x: 100,
      y: 100,
      toJSON: () => ({})
    }));
    document.body.appendChild(sourceElement);

    // Create fleet panel — must match .captain-panel[data-fleet-panel]
    const fleetPanel = document.createElement('div');
    fleetPanel.className = 'captain-panel';
    fleetPanel.dataset.fleetPanel = 'true';
    fleetPanel.getBoundingClientRect = jest.fn(() => ({
      top: 500,
      left: 600,
      width: 400,
      height: 600,
      right: 1000,
      bottom: 1100,
      x: 600,
      y: 500,
      toJSON: () => ({})
    }));
    document.body.appendChild(fleetPanel);

    const onComplete = jest.fn();
    const { result } = renderHook(() => useFlyToFleet({ duration: 600, onComplete }));
    const trigger = result.current;

    trigger(sourceElement);

    // Fast-forward through fly animation then pulse animation (800ms to match hook)
    jest.advanceTimersByTime(600);
    jest.advanceTimersByTime(800);

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cleans up clone element after animation', () => {
    const sourceElement = document.createElement('div');
    sourceElement.getBoundingClientRect = jest.fn(() => ({
      top: 100,
      left: 100,
      width: 200,
      height: 50,
      right: 300,
      bottom: 150,
      x: 100,
      y: 100,
      toJSON: () => ({})
    }));
    document.body.appendChild(sourceElement);

    // Create fleet panel — must match .captain-panel[data-fleet-panel]
    const fleetPanel = document.createElement('div');
    fleetPanel.className = 'captain-panel';
    fleetPanel.dataset.fleetPanel = 'true';
    fleetPanel.getBoundingClientRect = jest.fn(() => ({
      top: 500,
      left: 600,
      width: 400,
      height: 600,
      right: 1000,
      bottom: 1100,
      x: 600,
      y: 500,
      toJSON: () => ({})
    }));
    document.body.appendChild(fleetPanel);

    const { result } = renderHook(() => useFlyToFleet({ duration: 600 }));
    const trigger = result.current;

    trigger(sourceElement);

    // Clone should exist
    const clonesBefore = document.querySelectorAll('[style*="position: fixed"]');
    expect(clonesBefore.length).toBeGreaterThan(0);

    // Fast-forward through animation
    jest.advanceTimersByTime(600);

    // Clone should be removed
    const clonesAfter = document.querySelectorAll('[style*="position: fixed"]');
    expect(clonesAfter.length).toBe(0);

    // Source should be restored
    expect(sourceElement.style.opacity).toBe('');
    expect(sourceElement.style.transition).toBe('');
  });
});
