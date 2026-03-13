import React, { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useSocket } from './hooks/useSocket';
import { ChatPanel } from './components/ChatPanel';
import { ActivityTree } from './components/ActivityTree';
import { SessionSwitcher } from './components/SessionSwitcher';
import { PluginMarketplace } from './components/PluginMarketplace';
import { InstalledPlugins } from './components/InstalledPlugins';
import { ThemeProvider } from './theme';
import './App.css';

interface AppContentProps {
  token: string | null;
  loading: boolean;
}

type ViewMode = 'chat' | 'marketplace' | 'installed';

function AppContent({ token, loading }: AppContentProps) {
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

  const [viewMode, setViewMode] = useState<ViewMode>('chat');

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
      <div className="app-header">
        <div className="app-tabs">
          <button
            className={`app-tab ${viewMode === 'chat' ? 'active' : ''}`}
            onClick={() => setViewMode('chat')}
          >
            Chat
          </button>
          <button
            className={`app-tab ${viewMode === 'marketplace' ? 'active' : ''}`}
            onClick={() => setViewMode('marketplace')}
          >
            Plugin Marketplace
          </button>
          <button
            className={`app-tab ${viewMode === 'installed' ? 'active' : ''}`}
            onClick={() => setViewMode('installed')}
          >
            Installed Plugins
          </button>
        </div>
      </div>

      {viewMode === 'chat' && (
        <div className="app-layout-chat">
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
              sessionId={sessionId}
              currentTool={currentTool}
              toolLog={toolLog}
              selectedProject={selectedProject}
              selectedModel={selectedModel}
              onSendMessage={sendMessage}
              onSelectProject={handleSelectProject}
              onSelectModel={handleSelectModel}
              onCancel={cancelQuery}
            />
          </div>
          <div className="panel-activity">
            <ActivityTree tree={activityTree} usageStats={usageStats} />
          </div>
        </div>
      )}

      {viewMode === 'marketplace' && (
        <div className="app-view-full">
          <PluginMarketplace />
        </div>
      )}

      {viewMode === 'installed' && (
        <div className="app-view-full">
          <InstalledPlugins />
        </div>
      )}
    </div>
  );
}

function App() {
  const { token, loading } = useAuth();

  return (
    <ThemeProvider>
      <AppContent token={token} loading={loading} />
    </ThemeProvider>
  );
}

export default App;
