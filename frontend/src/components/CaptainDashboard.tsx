import React, { useState, useRef, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { useCaptainSocket } from '../hooks/useCaptainSocket';
import { useFleetState } from '../hooks/useFleetState';
import { CaptainChat } from './CaptainChat';
import { FleetMonitor } from './FleetMonitor';
import { FleetSessionDetail } from './FleetSessionDetail';
import './CaptainDashboard.css';

interface CaptainDashboardProps {
  socket: Socket | null;
  onSessionClick?: (sessionId: string, workspace: string) => void;
}

export const CaptainDashboard: React.FC<CaptainDashboardProps> = ({ socket, onSessionClick }) => {
  const { messages, isStreaming, isThinking, sendMessage, archivedConversations, clearHistory } = useCaptainSocket(socket);
  const { fleetState } = useFleetState(socket);
  const [dividerPosition, setDividerPosition] = useState(50);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionWorkspace, setSelectedSessionWorkspace] = useState<string>('');
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = () => {
    isDraggingRef.current = true;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const newPosition = ((e.clientX - rect.left) / rect.width) * 100;

      // Constrain between 30% and 70%
      const constrained = Math.max(30, Math.min(70, newPosition));
      setDividerPosition(constrained);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleSessionClick = (sessionId: string) => {
    // Find the workspace from fleet state
    const session = fleetState.sessions.find(s => s.sessionId === sessionId);
    const workspace = session?.workspace ?? '';

    // Show detail view instead of opening as tab
    setSelectedSessionId(sessionId);
    setSelectedSessionWorkspace(workspace);
  };

  const handleBackToFleet = () => {
    setSelectedSessionId(null);
    setSelectedSessionWorkspace('');
  };

  const handleOpenAsTab = (sessionId: string, workspace: string) => {
    if (onSessionClick) {
      onSessionClick(sessionId, workspace);
    }
  };

  return (
    <div className="captain-dashboard" ref={containerRef}>
      <div className="captain-panel" style={{ width: `${dividerPosition}%` }}>
        <CaptainChat
          messages={messages}
          isStreaming={isStreaming}
          isThinking={isThinking}
          onSendMessage={sendMessage}
          archivedConversations={archivedConversations}
          onClearHistory={clearHistory}
        />
      </div>

      <div className="captain-divider" onMouseDown={handleMouseDown} />

      <div className="captain-panel" style={{ width: `${100 - dividerPosition}%` }}>
        {selectedSessionId ? (
          <FleetSessionDetail
            sessionId={selectedSessionId}
            workspace={selectedSessionWorkspace}
            onBack={handleBackToFleet}
            onOpenAsTab={handleOpenAsTab}
          />
        ) : (
          <FleetMonitor fleetState={fleetState} onSessionClick={handleSessionClick} />
        )}
      </div>
    </div>
  );
};
