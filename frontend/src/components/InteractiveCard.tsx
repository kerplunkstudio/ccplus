import React from 'react';
import './InteractiveCard.css';

interface InteractiveCardButton {
  label: string;
  type: 'primary' | 'danger' | 'default';
}

interface InteractiveCardProps {
  message: string;
  buttons: InteractiveCardButton[];
  state: 'pending' | 'responded' | 'expired';
  selectedIndex?: number;
  onSelect?: (index: number) => void;
}

export function InteractiveCard({
  message,
  buttons,
  state,
  selectedIndex,
  onSelect
}: InteractiveCardProps) {
  const handleClick = (index: number) => {
    if (state === 'pending' && onSelect) {
      onSelect(index);
    }
  };

  return (
    <div className="interactive-card" data-state={state}>
      <p className="interactive-card-text">{message}</p>

      <div className="interactive-card-actions">
        {buttons.map((button, index) => {
          const isSelected = state === 'responded' && selectedIndex === index;
          const buttonClasses = [
            'interactive-card-btn',
            `interactive-card-btn--${button.type}`,
            isSelected ? 'interactive-card-btn--selected' : ''
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={index}
              className={buttonClasses}
              disabled={state !== 'pending'}
              onClick={() => handleClick(index)}
            >
              {isSelected && (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 6l3 3 5-5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {button.label}
            </button>
          );
        })}
      </div>

      {state === 'expired' && (
        <span className="interactive-card-expired">Expired</span>
      )}
    </div>
  );
}
