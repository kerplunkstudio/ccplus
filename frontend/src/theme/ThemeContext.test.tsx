import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from './ThemeContext';
import { applyTheme } from './applyTheme';

// Mock applyTheme
jest.mock('./applyTheme');

describe('ThemeProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders children without crashing', () => {
    const { container } = render(
      <ThemeProvider>
        <div data-testid="child">Test Child</div>
      </ThemeProvider>
    );

    expect(container.querySelector('[data-testid="child"]')).toBeInTheDocument();
  });

  it('applies theme on mount', () => {
    render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>
    );

    expect(applyTheme).toHaveBeenCalledTimes(1);
  });

  it('applies correct theme preset', () => {
    render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>
    );

    const mockApplyTheme = applyTheme as jest.Mock;
    expect(mockApplyTheme).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.any(String),
      colors: expect.any(Object),
    }));
  });

  it('renders multiple children', () => {
    const { container } = render(
      <ThemeProvider>
        <div data-testid="child1">Child 1</div>
        <div data-testid="child2">Child 2</div>
        <div data-testid="child3">Child 3</div>
      </ThemeProvider>
    );

    expect(container.querySelector('[data-testid="child1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="child2"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="child3"]')).toBeInTheDocument();
  });

  it('does not re-apply theme on re-render with same props', () => {
    const { rerender } = render(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>
    );

    expect(applyTheme).toHaveBeenCalledTimes(1);

    // Re-render with same children
    rerender(
      <ThemeProvider>
        <div>Content</div>
      </ThemeProvider>
    );

    // Should still be called only once (useEffect dependencies are empty)
    expect(applyTheme).toHaveBeenCalledTimes(1);
  });

  it('handles nested components', () => {
    const NestedComponent = () => <span>Nested</span>;

    const { container } = render(
      <ThemeProvider>
        <div>
          <NestedComponent />
        </div>
      </ThemeProvider>
    );

    expect(container.textContent).toContain('Nested');
  });

  it('handles fragments as children', () => {
    const { container } = render(
      <ThemeProvider>
        <>
          <div data-testid="frag1">Fragment 1</div>
          <div data-testid="frag2">Fragment 2</div>
        </>
      </ThemeProvider>
    );

    expect(container.querySelector('[data-testid="frag1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="frag2"]')).toBeInTheDocument();
  });

  it('handles null children', () => {
    const { container } = render(
      <ThemeProvider>
        {null}
      </ThemeProvider>
    );

    expect(container.textContent).toBe('');
  });

  it('handles undefined children', () => {
    const { container } = render(
      <ThemeProvider>
        {undefined}
      </ThemeProvider>
    );

    expect(container.textContent).toBe('');
  });

  it('handles conditional children', () => {
    const showContent = true;

    const { container } = render(
      <ThemeProvider>
        {showContent && <div data-testid="conditional">Shown</div>}
        {!showContent && <div data-testid="hidden">Hidden</div>}
      </ThemeProvider>
    );

    expect(container.querySelector('[data-testid="conditional"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="hidden"]')).not.toBeInTheDocument();
  });
});
