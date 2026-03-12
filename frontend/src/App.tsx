import React from 'react';
import { useAuth } from './hooks/useAuth';
import { useSocket } from './hooks/useSocket';
import { ChatPanel } from './components/ChatPanel';
import { ActivityTree } from './components/ActivityTree';
import './App.css';

function App() {
  const { token, loading } = useAuth();
  const { connected, messages, streaming, activityTree, usageStats, sendMessage, cancelQuery } =
    useSocket(token);

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
      <div className="panel-activity">
        <ActivityTree tree={activityTree} usageStats={usageStats} />
      </div>
      <div className="panel-chat">
        <ChatPanel
          messages={messages}
          connected={connected}
          streaming={streaming}
          onSendMessage={sendMessage}
          onCancel={cancelQuery}
        />
      </div>
    </div>
  );
}

export default App;
