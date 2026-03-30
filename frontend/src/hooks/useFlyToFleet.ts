import { useCallback } from 'react';

export interface FlyToFleetOptions {
  duration?: number;
  onComplete?: () => void;
}

/**
 * Creates a fly-to-fleet animation from a source element to the fleet panel.
 * The source element is cloned, positioned absolutely, then animated to the fleet panel.
 *
 * @param options - Animation configuration
 * @returns A trigger function that accepts the source element
 */
export function useFlyToFleet(options: FlyToFleetOptions = {}) {
  const { duration = 600, onComplete } = options;

  const trigger = useCallback((sourceElement: HTMLElement | null) => {
    if (!sourceElement) return;

    // Find the fleet monitor panel
    const fleetPanel = document.querySelector('.fleet-monitor');
    if (!fleetPanel) {
      // Graceful fallback: just fade out the source
      sourceElement.style.transition = 'opacity 300ms ease-out';
      sourceElement.style.opacity = '0';
      setTimeout(() => {
        sourceElement.style.opacity = '';
        sourceElement.style.transition = '';
        onComplete?.();
      }, 300);
      return;
    }

    // Get positions
    const sourceRect = sourceElement.getBoundingClientRect();
    const targetRect = fleetPanel.getBoundingClientRect();

    // Calculate translation needed
    const deltaX = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
    const deltaY = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);

    // Create a clone of the source element
    const clone = sourceElement.cloneNode(true) as HTMLElement;
    clone.style.position = 'fixed';
    clone.style.top = `${sourceRect.top}px`;
    clone.style.left = `${sourceRect.left}px`;
    clone.style.width = `${sourceRect.width}px`;
    clone.style.height = `${sourceRect.height}px`;
    clone.style.margin = '0';
    clone.style.zIndex = '10000';
    clone.style.pointerEvents = 'none';
    clone.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${duration}ms ease-out`;
    clone.style.transformOrigin = 'center center';

    // Append to body
    document.body.appendChild(clone);

    // Hide original immediately
    sourceElement.style.opacity = '0';
    sourceElement.style.transition = 'opacity 150ms ease-out';

    // Start animation on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clone.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.3) rotate(3deg)`;
        clone.style.opacity = '0.4';
      });
    });

    // Cleanup and trigger fleet pulse
    setTimeout(() => {
      clone.remove();
      sourceElement.style.opacity = '';
      sourceElement.style.transition = '';

      // Trigger fleet panel pulse
      const fleetElement = fleetPanel as HTMLElement;
      fleetElement.classList.add('fleet-panel-pulse');

      // Remove pulse class after animation
      setTimeout(() => {
        fleetElement.classList.remove('fleet-panel-pulse');
        onComplete?.();
      }, 500);
    }, duration);
  }, [duration, onComplete]);

  return trigger;
}
