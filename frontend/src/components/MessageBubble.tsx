import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '../types';
import { useTheme } from '../theme/ThemeContext';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
  onLinkClick?: (url: string, text: string) => void;
}

const getCodeBlockStyle = (isLight: boolean) => ({
  margin: 0,
  borderRadius: '0 0 8px 8px',
  background: isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(0, 0, 0, 0.3)',
  fontSize: '13px',
});

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({ message, onLinkClick }) => {
  const { isLight } = useTheme();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<Record<string, boolean>>({});

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Linkify file paths in markdown content (outside code blocks)
  const linkifyFilePaths = useCallback((content: string): string => {
    // File path patterns: relative (./, ../, src/, etc) and absolute (/Users/, /home/, etc)
    // Lookbehind: don't match after :, /, (, [, ", ` to avoid URLs (https://) and existing markdown links
    const filePathRegex = /(?<![:/(["`])(?:\.{1,2}\/[\w._-]+(?:\/[\w._-]+)*\.[\w]+|(?:src|frontend|backend-ts|\.claude)\/[\w._-]+(?:\/[\w._-]+)*(?:\.[\w]+)?|\/(?:Users|home|tmp|var)\/[\w._-]+(?:\/[\w._-]+)*\.[\w]+)(?![)\]"`])/g;

    // Split content by code blocks (both inline and fenced)
    const parts: string[] = [];
    let lastIndex = 0;

    // Match both inline code (`...`) and fenced code blocks (```...```)
    // Using [\s\S] instead of . with s flag for ES5 compatibility
    const codeBlockRegex = /(`{1,3})([\s\S]*?)\1/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Process text before code block
      const beforeCode = content.slice(lastIndex, match.index);
      parts.push(beforeCode.replace(filePathRegex, (path) => `[${path}](file://${path})`));

      // Keep code block as-is
      parts.push(match[0]);
      lastIndex = match.index + match[0].length;
    }

    // Process remaining text after last code block
    const afterCode = content.slice(lastIndex);
    parts.push(afterCode.replace(filePathRegex, (path) => `[${path}](file://${path})`));

    return parts.join('');
  }, []);


  const markdownComponents = useMemo<Partial<Components>>(() => ({
    code(props) {
      const { className, children, ...rest } = props;
      const isInline = !className;
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');

      if (isInline) {
        return (
          <code className="inline-code" {...rest}>
            {children}
          </code>
        );
      }

      const blockId = `code_${codeString.slice(0, 20)}`;
      const isMarkdown = language === 'markdown';
      const showPreview = isMarkdown && previewMarkdown[blockId];

      return (
        <div className="code-block-wrapper">
          <div className="code-block-header">
            <span className="code-language">{language || 'code'}</span>
            <div className="code-block-controls">
              {isMarkdown && (
                <button
                  className={`toggle-preview-btn ${showPreview ? 'active' : ''}`}
                  onClick={() => setPreviewMarkdown(prev => ({ ...prev, [blockId]: !prev[blockId] }))}
                  aria-label={showPreview ? 'Show code view' : 'Show preview'}
                  aria-pressed={showPreview}
                >
                  {showPreview ? 'Code' : 'Preview'}
                </button>
              )}
              <button
                className={`copy-code-btn ${copiedId === blockId ? 'copied' : ''}`}
                onClick={() => copyToClipboard(codeString, blockId)}
                aria-label={copiedId === blockId ? 'Code copied' : 'Copy code to clipboard'}
              >
                {copiedId === blockId ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="copy-check-icon" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Copied
                  </>
                ) : 'Copy'}
              </button>
            </div>
          </div>
          {showPreview ? (
            <div className="markdown-preview">
              <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                {codeString}
              </ReactMarkdown>
            </div>
          ) : (
            <SyntaxHighlighter
              language={language || 'text'}
              style={isLight ? vs : vscDarkPlus}
              customStyle={getCodeBlockStyle(isLight)}
            >
              {codeString}
            </SyntaxHighlighter>
          )}
        </div>
      );
    },
    a({ href, children, ...props }) {
      const isFilePath = href?.startsWith('file://');
      return (
        <a
          href={href}
          className={isFilePath ? 'file-path-link' : undefined}
          {...props}
        >
          {children}
        </a>
      );
    },
  }), [copiedId, copyToClipboard, previewMarkdown, isLight]);

  // Intercept link clicks via event delegation (more reliable than react-markdown component override)
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor && onLinkClick) {
      const href = anchor.getAttribute('href');
      if (href) {
        e.preventDefault();
        e.stopPropagation();
        onLinkClick(href, anchor.textContent || href);
      }
    }
  }, [onLinkClick]);

  // Two-tier markdown rendering: debounce parsing during active streaming to reduce CPU usage.
  // During streaming (~60 fps), we throttle the full ReactMarkdown parse to every ~150ms.
  // The "streaming tail" (unparsed content since last parse) is shown as a plain span for
  // instant feedback while the full parse catches up.
  const [parsedContent, setParsedContent] = useState(message.content ?? '');
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!message.streaming) {
      // Not streaming — parse immediately with no delay
      if (parseTimerRef.current) {
        clearTimeout(parseTimerRef.current);
        parseTimerRef.current = null;
      }
      setParsedContent(message.content ?? '');
      return;
    }

    // Streaming — debounce the parse to 150ms after last content change
    if (parseTimerRef.current) {
      clearTimeout(parseTimerRef.current);
    }
    parseTimerRef.current = setTimeout(() => {
      setParsedContent(message.content ?? '');
      parseTimerRef.current = null;
    }, 150);

    return () => {
      if (parseTimerRef.current) {
        clearTimeout(parseTimerRef.current);
        parseTimerRef.current = null;
      }
    };
  }, [message.content, message.streaming]);

  // Memoize markdown rendering — now driven by parsedContent (throttled during streaming)
  const renderedMarkdown = useMemo(() => {
    const linkedContent = linkifyFilePaths(parsedContent);
    return (
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {linkedContent}
      </ReactMarkdown>
    );
  }, [parsedContent, markdownComponents, linkifyFilePaths]);

  // Memoize user message linkifyFilePaths call (parallel to renderedMarkdown)
  const linkedUserContent = useMemo(() => {
    return linkifyFilePaths(message.content || '');
  }, [message.content, linkifyFilePaths]);

  // Tail content: text that has arrived since the last debounced parse.
  // Only relevant for assistant streaming messages — shown as plain text for instant feedback.
  const streamingTail = message.streaming && message.role === 'assistant'
    ? (message.content ?? '').slice(parsedContent.length)
    : '';

  // Handle compact boundary messages (after all hooks)
  if (message.isCompactBoundary) {
    return <div className="compact-boundary">{message.content}</div>;
  }

  // Build CSS classes for animation states
  const bubbleClasses = [
    'message-bubble',
    message.role,
    message.streaming && 'streaming',
    message.pending && 'pending'
  ].filter(Boolean).join(' ');

  return (
    <div className={bubbleClasses}>
      <div className="message-bubble-inner">
        {message.images && message.images.length > 0 && (
          <div className="message-images">
            {message.images.map((img) => (
              <div key={img.id} className="message-image-container">
                <img src={img.url} alt={img.filename} className="message-image" />
              </div>
            ))}
          </div>
        )}
        {message.role === 'assistant' ? (
          <div className="message-markdown" onClick={handleContentClick}>
            {renderedMarkdown}
            {streamingTail && (
              <span className="streaming-tail">{streamingTail}</span>
            )}
            {/* C3: Blinking cursor at end of streaming content */}
            {message.streaming && (message.content || streamingTail) && (
              <span className="streaming-cursor" aria-hidden="true">▌</span>
            )}
          </div>
        ) : (
          <>
            <div className="message-text" onClick={handleContentClick}>
              <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                {linkedUserContent}
              </ReactMarkdown>
            </div>
            {message.content && (
              <button
                className={`copy-message-btn ${copiedId === `msg_${message.id}` ? 'copied' : ''}`}
                onClick={() => copyToClipboard(message.content!, `msg_${message.id}`)}
                aria-label={copiedId === `msg_${message.id}` ? 'Message copied' : 'Copy message to clipboard'}
              >
                {copiedId === `msg_${message.id}` ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                )}
              </button>
            )}
          </>
        )}
      </div>
      <div className="message-meta">
        <span className="message-time">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
});
