import React, { useState, useEffect } from 'react';
import './ThinkingIndicatorEnhanced.css';

interface ThinkingIndicatorEnhancedProps {
  currentTool?: any;
  className?: string;
}

// Sophisticated thinking messages that match the observatory aesthetic
const THINKING_MESSAGES = [
  { text: 'Analyzing patterns...', icon: '🔍' },
  { text: 'Considering options...', icon: '🤔' },
  { text: 'Connecting the dots...', icon: '🔗' },
  { text: 'Exploring the codebase...', icon: '📁' },
  { text: 'Reading between the lines...', icon: '📖' },
  { text: 'Weighing possibilities...', icon: '⚖️' },
  { text: 'Synthesizing insights...', icon: '💡' },
  { text: 'Tracing dependencies...', icon: '🕸️' },
  { text: 'Mapping architecture...', icon: '🗺️' },
  { text: 'Assembling context...', icon: '🧩' },
];

export const ThinkingIndicatorEnhanced: React.FC<ThinkingIndicatorEnhancedProps> = ({
  currentTool,
  className = ''
}) => {
  const [messageIndex, setMessageIndex] = useState(0);
  const [pulsePhase, setPulsePhase] = useState(0);

  useEffect(() => {
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % THINKING_MESSAGES.length);
    }, 3000);

    const pulseInterval = setInterval(() => {
      setPulsePhase((prev) => (prev + 1) % 3);
    }, 600);

    return () => {
      clearInterval(messageInterval);
      clearInterval(pulseInterval);
    };
  }, []);

  const currentMessage = THINKING_MESSAGES[messageIndex];

  if (currentTool) {
    return (
      <div className={`thinking-enhanced tool-active ${className}`}>
        <div className="tool-execution">
          <div className="tool-indicator">
            <div className="tool-pulse" />
            <div className="tool-icon">
              {currentTool.tool_name === 'Agent' && '🤖'}
              {currentTool.tool_name === 'Read' && '📖'}
              {currentTool.tool_name === 'Edit' && '✏️'}
              {currentTool.tool_name === 'Write' && '📝'}
              {currentTool.tool_name === 'Bash' && '⚡'}
              {currentTool.tool_name === 'Grep' && '🔍'}
              {!['Agent', 'Read', 'Edit', 'Write', 'Bash', 'Grep'].includes(currentTool.tool_name) && '⚙️'}
            </div>
          </div>
          <div className="tool-description">
            <div className="tool-name">{currentTool.tool_name}</div>
            <div className="tool-action">
              {currentTool.tool_name === 'Agent' && 'Spawning intelligence...'}
              {currentTool.tool_name === 'Read' && 'Absorbing knowledge...'}
              {currentTool.tool_name === 'Edit' && 'Crafting changes...'}
              {currentTool.tool_name === 'Write' && 'Creating content...'}
              {currentTool.tool_name === 'Bash' && 'Executing commands...'}
              {currentTool.tool_name === 'Grep' && 'Searching patterns...'}
              {!['Agent', 'Read', 'Edit', 'Write', 'Bash', 'Grep'].includes(currentTool.tool_name) && 'Working...'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`thinking-enhanced ${className}`}>
      <div className="thinking-content">
        <div className="thinking-dots">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className={`thinking-dot ${index === pulsePhase ? 'active' : ''}`}
            />
          ))}
        </div>
        <div className="thinking-message">
          <span className="thinking-icon">{currentMessage.icon}</span>
          <span className="thinking-text">{currentMessage.text}</span>
        </div>
      </div>
    </div>
  );
};