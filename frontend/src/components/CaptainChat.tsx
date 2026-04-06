import React, { useRef, useEffect, useState } from 'react';
import { Message, ImageAttachment } from '../types';
import { InteractiveMessage } from '../types/interactive';
import { MessageBubble } from './MessageBubble';
import { InteractiveCard } from './InteractiveCard';
import { SessionProposalCard } from './SessionProposalCard';
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
  isModelThinking?: boolean;
  toolActivity?: string | null;
  onSendMessage: (content: string, workspace?: string, model?: string, imageIds?: string[], images?: ImageAttachment[]) => void;
  sessionId?: string;
  archivedConversations: CaptainConversation[];
  onClearHistory: () => void;
  interactiveMessages: InteractiveMessage[];
  onRespondToInteractive: (messageId: string, actionId: string) => void;
  contextPct?: number;
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
  isModelThinking,
  toolActivity,
  onSendMessage,
  sessionId,
  archivedConversations,
  onClearHistory,
  interactiveMessages,
  onRespondToInteractive,
  contextPct,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedConvId, setExpandedConvId] = useState<string | null>(null);

  useEffect(() => {
    if (isInitialMount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      isInitialMount.current = false;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, interactiveMessages]);

  const handleToggleHistory = () => {
    setShowHistory((prev) => !prev);
    setExpandedConvId(null);
  };

  const handleExpandConversation = (convId: string) => {
    setExpandedConvId((prev) => (prev === convId ? null : convId));
  };

  const hasArchive = archivedConversations.length > 0;

  // Merge messages and interactive messages, sorted by timestamp
  type TimelineItem =
    | { type: 'message'; data: Message; timestamp: number }
    | { type: 'interactive'; data: InteractiveMessage; timestamp: number };

  const timeline: TimelineItem[] = [
    ...messages.map((msg) => ({ type: 'message' as const, data: msg, timestamp: msg.timestamp })),
    ...interactiveMessages.map((msg) => ({ type: 'interactive' as const, data: msg, timestamp: msg.createdAt })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div className="captain-chat">
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

      {messages.length > 0 && (
        <div className="captain-context-bar">
          <div className="captain-context-usage">
            <div className="captain-context-track">
              <div
                className={`captain-context-fill${(contextPct ?? 0) > 90 ? ' danger' : (contextPct ?? 0) > 75 ? ' warning' : ''}`}
                style={{ width: `${Math.min(contextPct ?? 0, 100)}%` }}
              />
            </div>
            <span className="captain-context-label">{Math.round(contextPct ?? 0)}% context</span>
          </div>
          <div className="captain-context-actions">
            {hasArchive && (
              <button className="captain-context-action" onClick={handleToggleHistory}>
                History
              </button>
            )}
            <button className="captain-context-action" onClick={() => onSendMessage('/clear')}>
              New conversation
            </button>
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
            {timeline.map((item) => {
              if (item.type === 'message') {
                const msg = item.data;
                // Check if this is a session proposal message
                if (msg.type === 'session_proposal' && msg.sessionId && msg.proposalPrompt && msg.proposalWorkspace && msg.proposalWorkflow) {
                  return (
                    <SessionProposalCard
                      key={msg.id}
                      sessionId={msg.sessionId}
                      prompt={msg.proposalPrompt}
                      workspace={msg.proposalWorkspace}
                      workflow={msg.proposalWorkflow}
                    />
                  );
                }
                return <MessageBubble key={msg.id} message={msg} />;
              } else {
                // Map InteractiveMessage to InteractiveCard props
                const { text, actions, responseState, selectedActionId } = item.data;
                const buttons = actions.map((action) => ({
                  label: action.label,
                  type: action.style as 'primary' | 'danger' | 'default',
                }));
                const state = responseState === 'cancelled' ? 'expired' : responseState;
                const selectedIndex = selectedActionId
                  ? actions.findIndex((action) => action.id === selectedActionId)
                  : undefined;
                const handleSelect = (index: number) => {
                  onRespondToInteractive(item.data.id, actions[index].id);
                };

                return (
                  <InteractiveCard
                    key={item.data.id}
                    message={text}
                    buttons={buttons}
                    state={state}
                    selectedIndex={selectedIndex}
                    onSelect={handleSelect}
                    isSessionProposal={!!item.data.sessionId}
                  />
                );
              }
            })}
            {isThinking && <ThinkingIndicator activityTree={[]} isModelThinking={isModelThinking} toolActivity={toolActivity} />}
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
          sessionId={sessionId}
        />
      </div>
    </div>
  );
};
