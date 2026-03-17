import React, { useState, useEffect } from 'react';
import { Message, ToolEvent, UsageStats, SignalState, ActivityNode } from '../types';
import { ChatPanelHeader } from './ChatPanelHeader';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { PluginModal } from './PluginModal';
import './ChatPanel.css';

interface ChatPanelProps {
  messages: Message[];
  connected: boolean;
  streaming: boolean;
  backgroundProcessing?: boolean;
  currentTool?: ToolEvent | null;
  toolLog: ToolEvent[];
  selectedModel: string;
  usageStats: UsageStats;
  onSendMessage: (content: string, workspace?: string, model?: string, imageIds?: string[]) => void;
  onSelectModel: (model: string) => void;
  onCancel: () => void;
  onToggleSessions?: () => void;
  onToggleActivity?: () => void;
  projectPath?: string | null;
  onLoadSession?: (sessionId: string) => void;
  sessionId?: string;
  pendingQuestion?: {
    questions: Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiSelect: boolean;
    }>;
    toolUseId: string;
} | null;
  onRespondToQuestion?: (response: Record<string, string>) => void;
  isRestoringSession?: boolean;
  onSendToNewSession?: (text: string) => void;
  onOpenBrowserTab?: (url: string, label: string) => void;
  pendingRestore?: boolean;
  signals?: SignalState;
  promptSuggestions?: string[];
  rateLimitState?: { active: boolean; retryAfterMs: number } | null;
  activityTree?: ActivityNode[];
  pendingInput?: string | null;
  onClearPendingInput?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  connected,
  streaming,
  backgroundProcessing = false,
  currentTool,
  toolLog,
  selectedModel,
  usageStats,
  onSendMessage,
  onSelectModel,
  onCancel,
  onToggleSessions,
  onToggleActivity,
  projectPath,
  onLoadSession,
  sessionId,
  pendingQuestion,
  onRespondToQuestion,
  isRestoringSession = false,
  onSendToNewSession,
  onOpenBrowserTab,
  pendingRestore = false,
  signals,
  promptSuggestions = [],
  rateLimitState,
  activityTree = [],
  pendingInput = null,
  onClearPendingInput,
}) => {
  const [pluginModalOpen, setPluginModalOpen] = useState(false);
  const [pastSessions, setPastSessions] = useState<Array<{session_id: string; last_user_message: string | null; last_activity: string}>>([]);

  // Fetch past sessions when empty state is shown
  useEffect(() => {
    if (messages.length > 0 || !projectPath) {
      setPastSessions([]);
      return;
    }
    const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';
    fetch(`${SOCKET_URL}/api/sessions?project=${encodeURIComponent(projectPath)}`)
      .then(res => res.ok ? res.json() : { sessions: [] })
      .then(data => setPastSessions(data.sessions || []))
      .catch(() => setPastSessions([]));
  }, [messages.length, projectPath]);

  return (
    <>
      <PluginModal isOpen={pluginModalOpen} onClose={() => setPluginModalOpen(false)} />
      <div className="chat-panel">
        <ChatPanelHeader
          connected={connected}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          onToggleSessions={onToggleSessions}
          onToggleActivity={onToggleActivity}
          onOpenPluginModal={() => setPluginModalOpen(true)}
        />

        <MessageList
          messages={messages}
          streaming={streaming}
          isRestoringSession={isRestoringSession}
          projectPath={projectPath}
          usageStats={usageStats}
          pastSessions={pastSessions}
          onLoadSession={onLoadSession}
          onSendToNewSession={onSendToNewSession}
          onOpenBrowserTab={onOpenBrowserTab}
          pendingQuestion={pendingQuestion}
          onRespondToQuestion={onRespondToQuestion}
          currentTool={currentTool}
          toolLog={toolLog}
          activityTree={activityTree}
          signals={signals}
        />

        <ChatInput
          connected={connected}
          streaming={streaming}
          backgroundProcessing={backgroundProcessing}
          onSendMessage={onSendMessage}
          onCancel={onCancel}
          sessionId={sessionId}
          projectPath={projectPath}
          messages={messages}
          pendingInput={pendingInput}
          onClearPendingInput={onClearPendingInput}
          rateLimitState={rateLimitState}
          promptSuggestions={promptSuggestions}
        />
      </div>
    </>
  );
};
