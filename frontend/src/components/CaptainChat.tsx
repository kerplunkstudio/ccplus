import React, { useRef, useEffect, useState } from 'react';
import { Message } from '../types';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ThinkingIndicator } from './ThinkingIndicator';
import './CaptainChat.css';

interface CaptainConversation {
  id: string;
  messages: Message[];
  startedAt: number;
  endedAt: number;
}

interface CaptainChatProps {
  messages: Message[];
  isStreaming: boolean;
  isThinking: boolean;
  onSendMessage: (content: string) => void;
  archivedConversations: CaptainConversation[];
  onClearHistory: () => void;
}

function formatConversationDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getConversationPreview(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'Empty conversation';
  const text = firstUser.content ?? '';
  return text.length > 80 ? text.slice(0, 80) + '...' : text;
}

export const CaptainChat: React.FC<CaptainChatProps> = ({
  messages,
  isStreaming,
  isThinking,
  onSendMessage,
  archivedConversations,
  onClearHistory,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleToggleHistory = () => {
    setShowHistory((prev) => !prev);
    setExpandedConvId(null);
  };

  const handleExpandConversation = (convId: string) => {
    setExpandedConvId((prev) => (prev === convId ? null : convId));
  };

  const hasArchive = archivedConversations.length > 0;

  return (
    <div className="captain-chat">
      <div className="captain-header">
        <div className="captain-title">
          <span className="captain-icon">C</span>
          Captain
        </div>
        <div className="captain-header-actions">
          {hasArchive && (
            <button
              className={`captain-history-toggle ${showHistory ? 'active' : ''}`}
              onClick={handleToggleHistory}
              aria-label={showHistory ? 'Hide history' : 'Show history'}
            >
              {showHistory ? 'Close' : `${archivedConversations.length} past`}
            </button>
          )}
          {!isStreaming && (
            <div className="captain-status idle">Ready</div>
          )}
        </div>
      </div>

      {showHistory && (
        <div className="captain-history">
          <div className="captain-history-header">
            <span className="captain-history-label">Past conversations</span>
            <button className="captain-history-clear" onClick={onClearHistory}>
              Clear all
            </button>
          </div>
          <div className="captain-history-list">
            {archivedConversations.map((conv) => (
              <div key={conv.id} className="captain-history-item">
                <button
                  className={`captain-history-entry ${expandedConvId === conv.id ? 'expanded' : ''}`}
                  onClick={() => handleExpandConversation(conv.id)}
                >
                  <span className="captain-history-preview">
                    {getConversationPreview(conv.messages)}
                  </span>
                  <span className="captain-history-meta">
                    {formatConversationDate(conv.startedAt)} · {conv.messages.length} msg
                  </span>
                </button>
                {expandedConvId === conv.id && (
                  <div className="captain-history-messages">
                    {conv.messages.map((msg) => (
                      <MessageBubble key={msg.id} message={msg} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="captain-messages">
        {messages.length === 0 && !showHistory ? (
          <div className="captain-welcome">
            <h2>Captain</h2>
            <p>
              Fleet orchestrator. Starts sessions, monitors progress, flags issues.
            </p>
            <div className="captain-examples">
              <p className="captain-examples-label">Examples:</p>
              <button className="captain-example" onClick={() => onSendMessage('What sessions are running right now?')}>
                "What sessions are running right now?"
              </button>
              <button className="captain-example" onClick={() => onSendMessage('Start a session to refactor server.ts into smaller modules')}>
                "Start a session to refactor server.ts into smaller modules"
              </button>
              <button className="captain-example" onClick={() => onSendMessage('Show me the status of all sessions and flag any that look stuck')}>
                "Show me the status of all sessions and flag any that look stuck"
              </button>
            </div>
            {hasArchive && !showHistory && (
              <button className="captain-resume-hint" onClick={handleToggleHistory}>
                {archivedConversations.length} previous conversation{archivedConversations.length !== 1 ? 's' : ''} available
              </button>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isThinking && <ThinkingIndicator activityTree={[]} />}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="captain-input-wrapper">
        <ChatInput
          onSendMessage={onSendMessage}
          connected={true}
          streaming={isStreaming}
          backgroundProcessing={false}
          onCancel={() => {}}
          messages={messages}
        />
      </div>
    </div>
  );
};
