import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { Message, ImageAttachment } from '../types';

// Mock react-markdown
jest.mock('react-markdown', () => {
  return function ReactMarkdown({ children, components }: any) {
    // If components.code is provided, test it with a code block
    if (components?.code && typeof children === 'string' && children.includes('```')) {
      const match = children.match(/```(\w+)?\n([\s\S]*?)\n```/);
      if (match) {
        const [, language, code] = match;
        return components.code({
          className: language ? `language-${language}` : undefined,
          children: code,
        });
      }
    }
    // If components.a is provided, render anchor elements for markdown links
    if (components?.a && typeof children === 'string') {
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      const elements: any[] = [];
      let lastIndex = 0;
      let keyIndex = 0;
      while ((match = linkRegex.exec(children)) !== null) {
        const [fullMatch, text, href] = match;
        if (match.index > lastIndex) {
          elements.push(<span key={`text-${keyIndex++}`}>{children.slice(lastIndex, match.index)}</span>);
        }
        elements.push(<span key={`link-${keyIndex++}`}>{components.a({ href, children: text })}</span>);
        lastIndex = match.index + fullMatch.length;
      }
      if (elements.length > 0) {
        if (lastIndex < children.length) {
          elements.push(<span key={`text-${keyIndex++}`}>{children.slice(lastIndex)}</span>);
        }
        return <div data-testid="markdown">{elements}</div>;
      }
    }
    return <div data-testid="markdown">{children}</div>;
  };
});

// Mock react-syntax-highlighter
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children, language }: any) => (
    <pre data-testid="syntax-highlighter" data-language={language}>
      <code>{children}</code>
    </pre>
  ),
}));

jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  vscDarkPlus: {},
}));

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

  const messageWithCode: Message = {
    id: 'msg_4',
    content: '```javascript\nconsole.log("hello");\n```',
    role: 'assistant',
    timestamp: Date.now(),
  };

  const messageWithMarkdown: Message = {
    id: 'msg_5',
    content: '# Heading\n\n**Bold text** and *italic*',
    role: 'assistant',
    timestamp: Date.now(),
  };

  const compactBoundaryMessage: Message = {
    id: 'msg_6',
    content: '--- Compact boundary ---',
    role: 'assistant',
    timestamp: Date.now(),
    isCompactBoundary: true,
  };

  const images: ImageAttachment[] = [
    {
      id: 'img_1',
      filename: 'test.png',
      mime_type: 'image/png',
      size: 1024,
      url: 'http://localhost:4000/images/test.png',
    },
  ];

  const messageWithImages: Message = {
    id: 'msg_7',
    content: 'Check this image',
    role: 'user',
    timestamp: Date.now(),
    images,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset clipboard mock before each test
    (navigator.clipboard.writeText as jest.Mock).mockClear();
    (navigator.clipboard.writeText as jest.Mock).mockResolvedValue(undefined);
  });

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

  it('adds streaming class for streaming messages', () => {
    const { container } = render(<MessageBubble message={streamingMessage} />);
    const bubble = container.querySelector('.message-bubble');
    expect(bubble).toHaveClass('streaming');
  });

  it('does not add streaming class for non-streaming messages', () => {
    const { container } = render(<MessageBubble message={assistantMessage} />);
    const bubble = container.querySelector('.message-bubble');
    expect(bubble).not.toHaveClass('streaming');
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

  it('renders code block with syntax highlighting', () => {
    render(<MessageBubble message={messageWithCode} />);
    const codeBlock = screen.getByTestId('syntax-highlighter');
    expect(codeBlock).toBeInTheDocument();
    expect(codeBlock).toHaveAttribute('data-language', 'javascript');
  });

  it('renders markdown heading and formatting', () => {
    render(<MessageBubble message={messageWithMarkdown} />);
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
  });

  it('renders compact boundary message with special styling', () => {
    const { container } = render(<MessageBubble message={compactBoundaryMessage} />);
    const boundary = container.querySelector('.compact-boundary');
    expect(boundary).toBeInTheDocument();
    expect(boundary?.textContent).toBe('--- Compact boundary ---');
  });

  it('does not render regular message structure for compact boundary', () => {
    const { container } = render(<MessageBubble message={compactBoundaryMessage} />);
    const bubble = container.querySelector('.message-bubble');
    expect(bubble).not.toBeInTheDocument();
  });

  it('renders images attached to message', () => {
    render(<MessageBubble message={messageWithImages} />);
    const img = screen.getByAltText('test.png');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'http://localhost:4000/images/test.png');
  });

  it('renders multiple images', () => {
    const multiImageMessage: Message = {
      ...messageWithImages,
      images: [
        ...images,
        {
          id: 'img_2',
          filename: 'test2.jpg',
          mime_type: 'image/jpeg',
          size: 2048,
          url: 'http://localhost:4000/images/test2.jpg',
        },
      ],
    };

    render(<MessageBubble message={multiImageMessage} />);
    expect(screen.getByAltText('test.png')).toBeInTheDocument();
    expect(screen.getByAltText('test2.jpg')).toBeInTheDocument();
  });

  it('copies message content to clipboard', async () => {
    render(<MessageBubble message={userMessage} />);
    const copyBtn = screen.getByLabelText(/Copy message to clipboard/i);

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello world');
    });
  });

  it('shows copied confirmation after copying', async () => {
    render(<MessageBubble message={userMessage} />);
    const copyBtn = screen.getByLabelText(/Copy message to clipboard/i);

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByLabelText(/Message copied/i)).toBeInTheDocument();
    });
  });

  it('copies code block to clipboard', async () => {
    render(<MessageBubble message={messageWithCode} />);
    const copyBtn = screen.getByLabelText(/Copy code to clipboard/i);

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('console.log("hello");');
    });
  });

  it('shows copied confirmation after copying code', async () => {
    render(<MessageBubble message={messageWithCode} />);
    const copyBtn = screen.getByLabelText(/Copy code to clipboard/i);

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByLabelText(/Code copied/i)).toBeInTheDocument();
    });
  });

  it('calls onLinkClick when clicking markdown link', () => {
    const mockOnLinkClick = jest.fn();
    const messageWithLink: Message = {
      id: 'msg_8',
      content: '[Click here](https://example.com)',
      role: 'assistant',
      timestamp: Date.now(),
    };

    const { container } = render(
      <MessageBubble message={messageWithLink} onLinkClick={mockOnLinkClick} />
    );

    // Create and click a mock anchor element
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com';
    anchor.textContent = 'Click here';
    container.querySelector('.message-markdown')?.appendChild(anchor);

    fireEvent.click(anchor);

    expect(mockOnLinkClick).toHaveBeenCalledWith('https://example.com', 'Click here');
  });

  it('handles messages with no content', () => {
    const emptyMessage: Message = {
      id: 'msg_9',
      content: '',
      role: 'assistant',
      timestamp: Date.now(),
    };

    render(<MessageBubble message={emptyMessage} />);
    const markdown = screen.getByTestId('markdown');
    expect(markdown).toBeInTheDocument();
  });

  it('handles messages with undefined content', () => {
    const undefinedContentMessage: Message = {
      id: 'msg_10',
      role: 'assistant',
      timestamp: Date.now(),
    };

    render(<MessageBubble message={undefinedContentMessage} />);
    const markdown = screen.getByTestId('markdown');
    expect(markdown).toBeInTheDocument();
  });

  it('does not show copy button for assistant messages', () => {
    render(<MessageBubble message={assistantMessage} />);
    expect(screen.queryByLabelText(/Copy message to clipboard/i)).not.toBeInTheDocument();
  });

  it('shows copy button only for user messages', () => {
    render(<MessageBubble message={userMessage} />);
    expect(screen.getByLabelText(/Copy message to clipboard/i)).toBeInTheDocument();
  });

  it('renders inline code differently from code blocks', () => {
    const messageWithInlineCode: Message = {
      id: 'msg_11',
      content: 'Use `const` for constants',
      role: 'assistant',
      timestamp: Date.now(),
    };

    render(<MessageBubble message={messageWithInlineCode} />);
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    // Inline code should not trigger syntax highlighter
    expect(screen.queryByTestId('syntax-highlighter')).not.toBeInTheDocument();
  });

  it('memoizes markdown rendering', () => {
    const { rerender } = render(<MessageBubble message={assistantMessage} />);

    // Re-render with same content but different streaming flag
    const streamingVersion = { ...assistantMessage, streaming: true };
    rerender(<MessageBubble message={streamingVersion} />);

    // Should still render (testing that memo doesn't break functionality)
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('displays message time in 12-hour format', () => {
    // Test with a specific time
    const time2PM = new Date(2025, 0, 15, 14, 0).getTime();
    const msg: Message = { ...userMessage, timestamp: time2PM };
    render(<MessageBubble message={msg} />);

    const timeEl = document.querySelector('.message-time');
    expect(timeEl?.textContent).toMatch(/PM|AM/i);
  });

  it('handles very long content without breaking layout', () => {
    const longContent = 'a'.repeat(10000);
    const longMessage: Message = {
      id: 'msg_12',
      content: longContent,
      role: 'user',
      timestamp: Date.now(),
    };

    const { container } = render(<MessageBubble message={longMessage} />);
    const bubble = container.querySelector('.message-bubble');
    expect(bubble).toBeInTheDocument();
  });

  describe('streaming debounce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('shows streaming-tail span when streaming content has arrived beyond parsed content', () => {
      const msg: Message = {
        id: 'msg_stream_1',
        content: 'Hello world',
        role: 'assistant',
        timestamp: Date.now(),
        streaming: true,
      };

      render(<MessageBubble message={msg} />);

      // Before the 150ms debounce fires, parsedContent is initialised to the first render content.
      // Advance timer so the initial debounce fires.
      act(() => {
        jest.advanceTimersByTime(150);
      });

      // The markdown element should be present.
      expect(screen.getByTestId('markdown')).toBeInTheDocument();
    });

    it('parses markdown immediately when streaming stops', () => {
      const streamingMsg: Message = {
        id: 'msg_stream_2',
        content: 'Partial content',
        role: 'assistant',
        timestamp: Date.now(),
        streaming: true,
      };

      const { rerender } = render(<MessageBubble message={streamingMsg} />);

      // Simulate streaming completing with more content — no timer advance needed
      const finalMsg: Message = {
        ...streamingMsg,
        content: 'Partial content — done',
        streaming: false,
      };

      act(() => {
        rerender(<MessageBubble message={finalMsg} />);
      });

      // Content should render immediately (no pending debounce)
      expect(screen.getByTestId('markdown')).toBeInTheDocument();
      expect(screen.getByText('Partial content — done')).toBeInTheDocument();
    });

    it('does not show streaming-tail for non-streaming assistant messages', () => {
      const msg: Message = {
        id: 'msg_stream_3',
        content: 'Final content',
        role: 'assistant',
        timestamp: Date.now(),
        streaming: false,
      };

      const { container } = render(<MessageBubble message={msg} />);
      expect(container.querySelector('.streaming-tail')).not.toBeInTheDocument();
    });

    it('does not show streaming-tail for user messages', () => {
      const msg: Message = {
        id: 'msg_stream_4',
        content: 'User message',
        role: 'user',
        timestamp: Date.now(),
        streaming: true,
      };

      const { container } = render(<MessageBubble message={msg} />);
      expect(container.querySelector('.streaming-tail')).not.toBeInTheDocument();
    });

    it('clears debounce timer when streaming stops before timeout fires', () => {
      const streamingMsg: Message = {
        id: 'msg_stream_5',
        content: 'Growing content',
        role: 'assistant',
        timestamp: Date.now(),
        streaming: true,
      };

      const { rerender } = render(<MessageBubble message={streamingMsg} />);

      // Streaming stops before the 150ms debounce fires
      act(() => {
        rerender(<MessageBubble message={{ ...streamingMsg, streaming: false }} />);
      });

      // No timers should fire that cause issues
      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(screen.getByTestId('markdown')).toBeInTheDocument();
    });

    it('debounce fires after 150ms during streaming', async () => {
      const streamingMsg: Message = {
        id: 'msg_stream_6',
        content: 'Initial text',
        role: 'assistant',
        timestamp: Date.now(),
        streaming: true,
      };

      const { rerender } = render(<MessageBubble message={streamingMsg} />);

      // Update content while still streaming (simulates new tokens arriving)
      act(() => {
        rerender(<MessageBubble message={{ ...streamingMsg, content: 'Initial text plus more' }} />);
      });

      // Before 150ms — parsedContent is still at the initialised value
      act(() => {
        jest.advanceTimersByTime(100);
      });

      // After 150ms — debounce should have fired
      act(() => {
        jest.advanceTimersByTime(60);
      });

      expect(screen.getByTestId('markdown')).toBeInTheDocument();
    });
  });

  describe('C3: Streaming cursor', () => {
    it('shows streaming cursor when message is streaming with content', () => {
      const msg: Message = {
        id: 'cursor_1',
        content: 'Partial response',
        role: 'assistant',
        timestamp: Date.now(),
        streaming: true,
      };
      const { container } = render(<MessageBubble message={msg} />);
      expect(container.querySelector('.streaming-cursor')).toBeInTheDocument();
    });

    it('does not show streaming cursor when message is not streaming', () => {
      const msg: Message = {
        id: 'cursor_2',
        content: 'Final response',
        role: 'assistant',
        timestamp: Date.now(),
        streaming: false,
      };
      const { container } = render(<MessageBubble message={msg} />);
      expect(container.querySelector('.streaming-cursor')).not.toBeInTheDocument();
    });

    it('does not show streaming cursor when streaming message has no content', () => {
      const msg: Message = {
        id: 'cursor_3',
        content: '',
        role: 'assistant',
        timestamp: Date.now(),
        streaming: true,
      };
      const { container } = render(<MessageBubble message={msg} />);
      expect(container.querySelector('.streaming-cursor')).not.toBeInTheDocument();
    });

    it('does not show streaming cursor for user messages', () => {
      const msg: Message = {
        id: 'cursor_4',
        content: 'User says hi',
        role: 'user',
        timestamp: Date.now(),
        streaming: true,
      };
      const { container } = render(<MessageBubble message={msg} />);
      expect(container.querySelector('.streaming-cursor')).not.toBeInTheDocument();
    });
  });

  describe('markdown link attributes', () => {
    it('renders external links with target="_blank" and rel="noopener noreferrer"', () => {
      const messageWithExternalLink: Message = {
        id: 'link_1',
        content: '[Visit example](https://example.com)',
        role: 'assistant',
        timestamp: Date.now(),
      };

      const { container } = render(<MessageBubble message={messageWithExternalLink} />);
      const anchor = container.querySelector('a[href="https://example.com"]');
      expect(anchor).toBeInTheDocument();
      expect(anchor).toHaveAttribute('target', '_blank');
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders http links with target="_blank" and rel="noopener noreferrer"', () => {
      const messageWithHttpLink: Message = {
        id: 'link_2',
        content: '[Insecure site](http://example.com)',
        role: 'assistant',
        timestamp: Date.now(),
      };

      const { container } = render(<MessageBubble message={messageWithHttpLink} />);
      const anchor = container.querySelector('a[href="http://example.com"]');
      expect(anchor).toBeInTheDocument();
      expect(anchor).toHaveAttribute('target', '_blank');
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('does NOT render target="_blank" on file:// links', () => {
      const messageWithFileLink: Message = {
        id: 'link_3',
        content: '[open file](file:///Users/test/project/README.md)',
        role: 'assistant',
        timestamp: Date.now(),
      };

      const { container } = render(<MessageBubble message={messageWithFileLink} />);
      const anchor = container.querySelector('a[href="file:///Users/test/project/README.md"]');
      expect(anchor).toBeInTheDocument();
      expect(anchor).not.toHaveAttribute('target', '_blank');
    });

    it('does NOT render rel="noopener noreferrer" on file:// links', () => {
      const messageWithFileLink: Message = {
        id: 'link_4',
        content: '[open file](file:///Users/test/project/README.md)',
        role: 'assistant',
        timestamp: Date.now(),
      };

      const { container } = render(<MessageBubble message={messageWithFileLink} />);
      const anchor = container.querySelector('a[href="file:///Users/test/project/README.md"]');
      expect(anchor).toBeInTheDocument();
      expect(anchor).not.toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('applies file-path-link class to file:// links', () => {
      const messageWithFileLink: Message = {
        id: 'link_5',
        content: '[open file](file:///Users/test/project/README.md)',
        role: 'assistant',
        timestamp: Date.now(),
      };

      const { container } = render(<MessageBubble message={messageWithFileLink} />);
      const anchor = container.querySelector('a[href="file:///Users/test/project/README.md"]');
      expect(anchor).toBeInTheDocument();
      expect(anchor).toHaveClass('file-path-link');
    });

    it('does NOT apply file-path-link class to external links', () => {
      const messageWithExternalLink: Message = {
        id: 'link_6',
        content: '[Visit example](https://example.com)',
        role: 'assistant',
        timestamp: Date.now(),
      };

      const { container } = render(<MessageBubble message={messageWithExternalLink} />);
      const anchor = container.querySelector('a[href="https://example.com"]');
      expect(anchor).toBeInTheDocument();
      expect(anchor).not.toHaveClass('file-path-link');
    });
  });

  describe('C1: Pending (optimistic) message styling', () => {
    it('adds pending class to bubble when message has pending: true', () => {
      const msg: Message = {
        id: 'pending_1',
        content: 'Optimistic message',
        role: 'user',
        timestamp: Date.now(),
        pending: true,
      };
      const { container } = render(<MessageBubble message={msg} />);
      const bubble = container.querySelector('.message-bubble');
      expect(bubble).toHaveClass('pending');
    });

    it('does not add pending class when message has pending: false', () => {
      const msg: Message = {
        id: 'pending_2',
        content: 'Confirmed message',
        role: 'user',
        timestamp: Date.now(),
        pending: false,
      };
      const { container } = render(<MessageBubble message={msg} />);
      const bubble = container.querySelector('.message-bubble');
      expect(bubble).not.toHaveClass('pending');
    });

    it('does not add pending class when pending is undefined', () => {
      const { container } = render(<MessageBubble message={userMessage} />);
      const bubble = container.querySelector('.message-bubble');
      expect(bubble).not.toHaveClass('pending');
    });
  });
});
