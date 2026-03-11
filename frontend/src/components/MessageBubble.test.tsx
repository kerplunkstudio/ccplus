import React from 'react';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { Message } from '../types';

describe('MessageBubble', () => {
  const userMessage: Message = {
    id: 'msg_1',
    content: 'Hello world',
    role: 'user',
    timestamp: Date.now(),
  };

  const assistantMessage: Message = {
    id: 'msg_2',
    content: 'Hi there!',
    role: 'assistant',
    timestamp: Date.now(),
  };

  const streamingMessage: Message = {
    id: 'msg_3',
    content: 'Thinking about',
    role: 'assistant',
    timestamp: Date.now(),
    streaming: true,
  };

  it('renders user message with correct text', () => {
    render(<MessageBubble message={userMessage} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders user message with user class', () => {
    const { container } = render(<MessageBubble message={userMessage} />);
    const bubble = container.querySelector('.message-bubble');
    expect(bubble).toHaveClass('user');
  });

  it('renders assistant message with assistant class', () => {
    const { container } = render(<MessageBubble message={assistantMessage} />);
    const bubble = container.querySelector('.message-bubble');
    expect(bubble).toHaveClass('assistant');
  });

  it('renders assistant message through markdown', () => {
    render(<MessageBubble message={assistantMessage} />);
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('shows streaming cursor for streaming messages', () => {
    const { container } = render(<MessageBubble message={streamingMessage} />);
    const cursor = container.querySelector('.streaming-cursor');
    expect(cursor).toBeInTheDocument();
  });

  it('does not show streaming cursor for non-streaming messages', () => {
    const { container } = render(<MessageBubble message={assistantMessage} />);
    const cursor = container.querySelector('.streaming-cursor');
    expect(cursor).not.toBeInTheDocument();
  });

  it('displays formatted time', () => {
    const fixedTime = new Date(2025, 0, 15, 14, 30).getTime();
    const msg: Message = { ...userMessage, timestamp: fixedTime };
    render(<MessageBubble message={msg} />);
    // Should contain a time string (format varies by locale)
    const timeEl = document.querySelector('.message-time');
    expect(timeEl).toBeInTheDocument();
    expect(timeEl?.textContent).toBeTruthy();
  });
});
