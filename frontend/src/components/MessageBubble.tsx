import React, { useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '../types';
import { ToolLog } from './ToolLog';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
}

const codeBlockStyle = {
  margin: 0,
  borderRadius: '0 0 8px 8px',
  background: 'rgba(0, 0, 0, 0.3)',
  fontSize: '13px',
};

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({ message }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<Record<string, boolean>>({});
  const previousStreamingRef = React.useRef(message.streaming);
  const [displayedText, setDisplayedText] = useState('');
  const streamingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastContentLengthRef = React.useRef(0);

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

  // Sophisticated streaming text reveal
  React.useEffect(() => {
    if (!message.streaming) {
      // Ensure final content is shown when streaming stops
      setDisplayedText(message.content ?? '');
      return;
    }

    const content = message.content ?? '';
    const currentLength = content.length;
    const previousLength = lastContentLengthRef.current;

    // Only update if there's new content
    if (currentLength <= previousLength) return;

    lastContentLengthRef.current = currentLength;

    // Clear any existing timeout
    if (streamingTimeoutRef.current) {
      clearTimeout(streamingTimeoutRef.current);
    }

    // Calculate reveal timing based on content characteristics
    const newContent = content.slice(previousLength);
    const hasCodeBlock = newContent.includes('```');
    const hasComplexStructure = /[{}\[\]().]/.test(newContent);

    // Adaptive timing - slower for complex content, faster for simple text
    const baseDelay = hasCodeBlock ? 15 : hasComplexStructure ? 8 : 5;
    const variance = Math.random() * 3; // Add natural variation
    const delay = Math.max(2, baseDelay + variance);

    // Organic character-by-character reveal
    const revealNextCharacter = () => {
      setDisplayedText(current => {
        const nextLength = current.length + 1;
        const newText = content.slice(0, nextLength);

        // Continue if there's more content to reveal
        if (nextLength < content.length) {
          const nextChar = content[nextLength];
          // Slight pause after punctuation for natural reading rhythm
          const pauseMultiplier = /[.!?;]/.test(nextChar) ? 2.5 : 1;

          streamingTimeoutRef.current = setTimeout(revealNextCharacter, delay * pauseMultiplier);
        }

        return newText;
      });
    };

    // Start the reveal with a small initial delay
    streamingTimeoutRef.current = setTimeout(revealNextCharacter, delay * 0.5);

    return () => {
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
      }
    };
  }, [message.content, message.streaming]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
      }
    };
  }, []);


  const markdownComponents = useMemo(() => ({
    code({ className, children, ...props }: any) {
      const isInline = !className;
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');

      if (isInline) {
        return (
          <code className="inline-code" {...props}>
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
                  aria-label="Toggle preview"
                >
                  {showPreview ? 'Code' : 'Preview'}
                </button>
              )}
              <button
                className={`copy-code-btn ${copiedId === blockId ? 'copied' : ''}`}
                onClick={() => copyToClipboard(codeString, blockId)}
                aria-label="Copy code"
              >
                {copiedId === blockId ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="copy-check-icon">
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
              style={vscDarkPlus}
              customStyle={codeBlockStyle}
            >
              {codeString}
            </SyntaxHighlighter>
          )}
        </div>
      );
    },
  }), [copiedId, copyToClipboard, previewMarkdown]);

  // Build CSS classes for animation states
  const bubbleClasses = [
    'message-bubble',
    message.role,
    message.streaming && 'streaming'
  ].filter(Boolean).join(' ');

  return (
    <div className={bubbleClasses}>
      {message.toolLog && message.toolLog.length > 0 && (
        <ToolLog events={message.toolLog} />
      )}
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
          <div className="message-markdown">
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {message.streaming ? displayedText : (message.content ?? '')}
            </ReactMarkdown>
            <span className={`streaming-cursor ${message.streaming ? 'visible' : 'hidden'}`} />
          </div>
        ) : (
          <>
            <div className="message-text">
              <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                {message.content || ''}
              </ReactMarkdown>
            </div>
            {message.content && (
              <button
                className={`copy-message-btn ${copiedId === `msg_${message.id}` ? 'copied' : ''}`}
                onClick={() => copyToClipboard(message.content!, `msg_${message.id}`)}
                aria-label="Copy message"
              >
                {copiedId === `msg_${message.id}` ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
