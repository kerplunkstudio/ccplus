import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PluginButton } from './PluginButton';

describe('PluginButton', () => {
  it('renders without crashing', () => {
    const mockOnClick = jest.fn();
    render(<PluginButton onClick={mockOnClick} />);

    const button = screen.getByRole('button', { name: /open plugin marketplace/i });
    expect(button).toBeInTheDocument();
  });

  it('calls onClick handler when clicked', () => {
    const mockOnClick = jest.fn();
    render(<PluginButton onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('has correct title attribute', () => {
    const mockOnClick = jest.fn();
    render(<PluginButton onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', 'Plugin Marketplace — Browse skills and extend Claude');
  });

  it('has correct aria-label', () => {
    const mockOnClick = jest.fn();
    render(<PluginButton onClick={mockOnClick} />);

    const button = screen.getByRole('button', { name: 'Open plugin marketplace' });
    expect(button).toBeInTheDocument();
  });

  it('has plugin-button class', () => {
    const mockOnClick = jest.fn();
    render(<PluginButton onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('plugin-button');
  });

  it('renders SVG icon', () => {
    const mockOnClick = jest.fn();
    const { container } = render(<PluginButton onClick={mockOnClick} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
  });

  it('SVG has grid icon with 4 rectangles', () => {
    const mockOnClick = jest.fn();
    const { container } = render(<PluginButton onClick={mockOnClick} />);

    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(4);
  });

  it('calls onClick multiple times correctly', () => {
    const mockOnClick = jest.fn();
    render(<PluginButton onClick={mockOnClick} />);

    const button = screen.getByRole('button');

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockOnClick).toHaveBeenCalledTimes(3);
  });

  it('is accessible via keyboard', () => {
    const mockOnClick = jest.fn();
    render(<PluginButton onClick={mockOnClick} />);

    const button = screen.getByRole('button');
    button.focus();

    expect(document.activeElement).toBe(button);
  });
});
