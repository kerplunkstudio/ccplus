import React from 'react';
import { InteractiveMessage, InteractiveAction } from '../types/interactive';
import './InteractiveCard.css';

interface InteractiveCardProps {
  readonly message: InteractiveMessage;
  readonly onRespond: (messageId: string, actionId: string) => void;
}

export const InteractiveCard: React.FC<InteractiveCardProps> = ({ message, onRespond }) => {
  const isPending = message.responseState === 'pending';
  const isResponded = message.responseState === 'responded';
  const isExpired = message.responseState === 'expired';

  const getButtonClass = (action: InteractiveAction, isSelected: boolean): string => {
    const baseClass = 'px-3 py-1.5 rounded text-sm transition-colors';

    let styleClass = '';
    if (action.style === 'primary') {
      styleClass = 'bg-amber-500 text-zinc-950 font-semibold hover:bg-amber-400 interactive-card-btn-primary';
    } else if (action.style === 'danger') {
      styleClass = 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30';
    } else {
      styleClass = 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600';
    }

    let stateClass = '';
    if (isResponded) {
      if (isSelected) {
        stateClass = 'ring-2 ring-amber-500';
      } else {
        stateClass = 'opacity-30';
      }
    } else if (isExpired) {
      stateClass = 'opacity-30';
    }

    return `${baseClass} ${styleClass} ${stateClass}`.trim();
  };

  const handleActionClick = (actionId: string) => {
    if (isPending) {
      onRespond(message.id, actionId);
    }
  };

  return (
    <div className={`interactive-card bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 ${isPending ? 'interactive-card-pending' : ''}`}>
      <p className="text-zinc-200 text-sm mb-3">{message.text}</p>
      <div className="flex gap-2 flex-wrap">
        {message.actions.map((action) => {
          const isSelected = isResponded && message.selectedActionId === action.id;
          return (
            <button
              key={action.id}
              className={getButtonClass(action, isSelected)}
              onClick={() => handleActionClick(action.id)}
              disabled={!isPending}
            >
              {action.label}
            </button>
          );
        })}
      </div>
      {isExpired && <p className="text-xs text-zinc-500 mt-2">Expired</p>}
    </div>
  );
};
