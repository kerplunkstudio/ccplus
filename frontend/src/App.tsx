import React, { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useSocket } from './hooks/useSocket';
import { ChatPanel } from './components/ChatPanel';
import { ActivityTree } from './components/ActivityTree';
import { SessionSwitcher } from './components/SessionSwitcher';
import { ThemeProvider } from './theme';
import { ThemePanel } from './components/ThemePanel';
import './App.css';

interface AppContentProps {
  token: string | null;
  loading: boolean;
  onThemePanelToggle: (isOpen: boolean) => void;
}

function AppContent({ token, loading, onThemePanelToggle }: AppContentProps) {
  const {
    connected,
    messages,
    streaming,
    currentTool,
    activityTree,
    usageStats,
    sessionId,
    toolLog,
    sendMessage,
    cancelQuery,
    switchSession,
    newSession,
  } = useSocket(token);

  const [selectedProject, setSelectedProject] = useState<string | null>(() => {
    return localStorage.getItem('ccplus_selected_project');
  });

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('ccplus_selected_model') || 'claude-sonnet-4-20250514';
  });

  const handleSelectProject = (path: string) => {
    setSelectedProject(path);
    localStorage.setItem('ccplus_selected_project', path);
  };

  const handleSelectModel = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('ccplus_selected_model', model);
  };

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Connecting...</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <div className="panel-sessions">
        <SessionSwitcher
          currentSessionId={sessionId}
          selectedProject={selectedProject}
          onSwitchSession={switchSession}
          onNewSession={newSession}
        />
      </div>
      <div className="panel-chat">
        <ChatPanel
          messages={messages}
          connected={connected}
          streaming={streaming}
          currentTool={currentTool}
          toolLog={toolLog}
          selectedProject={selectedProject}
          selectedModel={selectedModel}
          onSendMessage={sendMessage}
          onSelectProject={handleSelectProject}
          onSelectModel={handleSelectModel}
          onCancel={cancelQuery}
          onThemePanelToggle={onThemePanelToggle}
        />
      </div>
      <div className="panel-activity">
        <ActivityTree tree={activityTree} usageStats={usageStats} />
      </div>
    </div>
  );
}

function App() {
  const { token, loading } = useAuth();
  const [isThemePanelOpen, setIsThemePanelOpen] = useState(false);

  return (
    <ThemeProvider>
      <AppContent
        token={token}
        loading={loading}
        onThemePanelToggle={setIsThemePanelOpen}
      />
      <ThemePanel isOpen={isThemePanelOpen} onClose={() => setIsThemePanelOpen(false)} />
    </ThemeProvider>
  );
}

export default App;
