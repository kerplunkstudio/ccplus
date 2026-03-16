import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TextSelectionPopup } from './TextSelectionPopup';

describe('TextSelectionPopup', () => {
  let containerRef: React.RefObject<HTMLDivElement>;
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a container div with some text content
    container = document.createElement('div');
    container.innerHTML = '<p>This is some test text for selection</p>';
    document.body.appendChild(container);

    containerRef = { current: container };

    // Mock getBoundingClientRect for the container
    container.getBoundingClientRect = jest.fn(() => ({
      top: 100,
      left: 100,
      bottom: 200,
      right: 400,
      width: 300,
      height: 100,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    }));
  });

  afterEach(() => {
    // Clean up
    document.body.removeChild(container);
    window.getSelection()?.removeAllRanges();
  });

  it('renders hidden when no text is selected', () => {
    const onSendToNewSession = jest.fn();
    const { container: wrapper } = render(
      <TextSelectionPopup
        onSendToNewSession={onSendToNewSession}
        containerRef={containerRef}
      />
    );

    // The popup is always in the DOM but hidden via display: none
    const popup = wrapper.querySelector('.text-selection-popup');
    expect(popup).toBeInTheDocument();
    expect(popup).toHaveStyle({ display: 'none' });
  });

  it('renders popup when text is selected', async () => {
    const onSendToNewSession = jest.fn();
    render(
      <TextSelectionPopup
        onSendToNewSession={onSendToNewSession}
        containerRef={containerRef}
      />
    );

    // Simulate text selection
    const range = document.createRange();
    const textNode = container.querySelector('p')?.firstChild;
    if (textNode) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, 10);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      // Trigger mouseup event to update selection
      fireEvent.mouseUp(document);

      await waitFor(() => {
        expect(screen.getByText('Send to new session')).toBeInTheDocument();
      });
    }
  });

  it('calls onSendToNewSession with selected text when button is clicked', async () => {
    const onSendToNewSession = jest.fn();
    render(
      <TextSelectionPopup
        onSendToNewSession={onSendToNewSession}
        containerRef={containerRef}
      />
    );

    // Simulate text selection
    const range = document.createRange();
    const textNode = container.querySelector('p')?.firstChild;
    if (textNode) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, 10);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      fireEvent.mouseUp(document);

      await waitFor(() => {
        const button = screen.getByText('Send to new session');
        expect(button).toBeInTheDocument();

        // Click the button
        fireEvent.mouseDown(button, { preventDefault: jest.fn() });
        fireEvent.click(button);

        expect(onSendToNewSession).toHaveBeenCalledWith('This is so');
      });
    }
  });

  it('hides popup when selection is cleared', async () => {
    const onSendToNewSession = jest.fn();
    const { container: wrapper } = render(
      <TextSelectionPopup
        onSendToNewSession={onSendToNewSession}
        containerRef={containerRef}
      />
    );

    // Simulate text selection
    const range = document.createRange();
    const textNode = container.querySelector('p')?.firstChild;
    if (textNode) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, 10);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      fireEvent.mouseUp(document);

      await waitFor(() => {
        expect(screen.getByText('Send to new session')).toBeInTheDocument();
      });

      // Clear selection
      selection?.removeAllRanges();
      fireEvent.mouseUp(document);

      await waitFor(() => {
        // Popup is still in DOM but hidden via display: none
        const popup = wrapper.querySelector('.text-selection-popup');
        expect(popup).toHaveStyle({ display: 'none' });
      });
    }
  });

  it('does not show popup for selections outside container', async () => {
    const onSendToNewSession = jest.fn();
    const { container: wrapper } = render(
      <TextSelectionPopup
        onSendToNewSession={onSendToNewSession}
        containerRef={containerRef}
      />
    );

    // Create a separate element outside the container
    const outsideElement = document.createElement('p');
    outsideElement.textContent = 'Outside text';
    document.body.appendChild(outsideElement);

    const range = document.createRange();
    const textNode = outsideElement.firstChild;
    if (textNode) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, 7);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      fireEvent.mouseUp(document);

      // Wait a bit to ensure popup doesn't appear
      await new Promise(resolve => setTimeout(resolve, 50));

      // Popup should remain hidden
      const popup = wrapper.querySelector('.text-selection-popup');
      expect(popup).toHaveStyle({ display: 'none' });
    }

    document.body.removeChild(outsideElement);
  });

  it('displays an icon in the button', async () => {
    const onSendToNewSession = jest.fn();
    render(
      <TextSelectionPopup
        onSendToNewSession={onSendToNewSession}
        containerRef={containerRef}
      />
    );

    // Simulate text selection
    const range = document.createRange();
    const textNode = container.querySelector('p')?.firstChild;
    if (textNode) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      fireEvent.mouseUp(document);

      await waitFor(() => {
        const button = screen.getByText('Send to new session').closest('button');
        const svg = button?.querySelector('svg');
        expect(svg).toBeInTheDocument();
      });
    }
  });
});
