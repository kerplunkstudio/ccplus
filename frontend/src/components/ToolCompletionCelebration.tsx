import React, { useEffect, useState } from 'react';
import './ToolCompletionCelebration.css';

interface ToolCompletionCelebrationProps {
  toolName: string;
  success: boolean;
  duration?: number;
  onComplete?: () => void;
}

const SUCCESS_MESSAGES: Record<string, string> = {
  'Agent': 'Intelligence deployed',
  'Read': 'Knowledge absorbed',
  'Edit': 'Changes crafted',
  'Write': 'Content created',
  'Bash': 'Command executed',
  'Grep': 'Patterns found',
  'default': 'Task completed'
};

const SUCCESS_ICONS: Record<string, string> = {
  'Agent': '🤖',
  'Read': '📖',
  'Edit': '✨',
  'Write': '📝',
  'Bash': '⚡',
  'Grep': '🔍',
  'default': '✅'
};

export const ToolCompletionCelebration: React.FC<ToolCompletionCelebrationProps> = ({
  toolName,
  success,
  duration = 800,
  onComplete
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [animationPhase, setAnimationPhase] = useState<'enter' | 'celebrate' | 'exit'>('enter');

  const message = SUCCESS_MESSAGES[toolName] || SUCCESS_MESSAGES.default;
  const icon = SUCCESS_ICONS[toolName] || SUCCESS_ICONS.default;

  useEffect(() => {
    const timeline = [
      { phase: 'celebrate', delay: 100 },
      { phase: 'exit', delay: duration - 200 },
    ];

    const timeouts = timeline.map(({ phase, delay }) =>
      setTimeout(() => setAnimationPhase(phase as any), delay)
    );

    const hideTimeout = setTimeout(() => {
      setIsVisible(false);
      onComplete?.();
    }, duration);

    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(hideTimeout);
    };
  }, [duration, onComplete]);

  if (!isVisible) return null;

  return (
    <div className={`tool-completion ${success ? 'success' : 'error'} ${animationPhase}`}>
      <div className="completion-content">
        <div className="completion-icon">
          <span className="icon-symbol">{success ? icon : '❌'}</span>
          <div className="icon-ripple" />
        </div>
        <div className="completion-text">
          {success ? message : 'Task failed'}
        </div>
      </div>

      {success && (
        <div className="success-particles">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="particle"
              style={{
                '--delay': `${i * 0.1}s`,
                '--angle': `${i * 60}deg`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
};