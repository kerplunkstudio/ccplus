import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '../types';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (message.tool) {
    const statusEmoji =
      message.tool.status === 'running'
        ? '⏳'
        : message.tool.status === 'completed'
          ? '✓'
          : '✗';

    return (
      <div className={`message-bubble ${message.role} tool-message`}>
        <div className="message-bubble-inner">
          <div className="tool-status">
            <span className="tool-icon">{statusEmoji}</span>
            <span className="tool-name">{message.tool.tool_name}</span>
            {message.tool.agent_type && (
              <span className="agent-type">({message.tool.agent_type})</span>
            )}
          </div>
          {message.tool.duration_ms && (
            <div className="tool-duration">
              {(message.tool.duration_ms / 1000).toFixed(2)}s
            </div>
          )}
          {message.tool.error && <div className="tool-error">{message.tool.error}</div>}
        </div>
        <div className="message-meta">
          <span className="message-time">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`message-bubble ${message.role}`}>
      <div className="message-bubble-inner">
        {message.role === 'assistant' ? (
          <div className="message-markdown">
            <ReactMarkdown
              components={{
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

                  return (
                    <div className="code-block-wrapper">
                      <div className="code-block-header">
                        <span className="code-language">{language || 'code'}</span>
                        <button
                          className="copy-code-btn"
                          onClick={() => copyToClipboard(codeString, blockId)}
                          aria-label="Copy code"
                        >
                          {copiedId === blockId ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <SyntaxHighlighter
                        language={language || 'text'}
                        style={vscDarkPlus}
                        customStyle={{
                          margin: 0,
                          borderRadius: '0 0 8px 8px',
                          background: 'rgba(0, 0, 0, 0.4)',
                          fontSize: '13px',
                        }}
                      >
                        {codeString}
                      </SyntaxHighlighter>
                    </div>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
            {message.streaming && <span className="streaming-cursor" />}
          </div>
        ) : (
          <div className="message-text">
            <p>{message.content}</p>
          </div>
        )}
      </div>
      <div className="message-meta">
        <span className="message-time">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
};
