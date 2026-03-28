import React, { useState } from 'react';
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
  selectedIndices?: number[];
  onSelect?: (index: number) => void;
  onMultiSelect?: (indices: number[]) => void;
  multiSelect?: boolean;
  minSelections?: number;
  maxSelections?: number;
}

export function InteractiveCard({
  message,
  buttons,
  state,
  selectedIndex,
  selectedIndices,
  onSelect,
  onMultiSelect,
  multiSelect = false,
  minSelections = 1,
  maxSelections
}: InteractiveCardProps) {
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set());

  const handleSingleClick = (index: number) => {
    if (state === 'pending' && onSelect) {
      onSelect(index);
    }
  };

  const handleCheckboxChange = (index: number) => {
    if (state !== 'pending') return;

    setCheckedIndices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        // Check maxSelections constraint
        if (maxSelections && newSet.size >= maxSelections) {
          return prev; // Don't allow selection beyond max
        }
        newSet.add(index);
      }
      return newSet;
    });
  };

  const handleConfirm = () => {
    if (state === 'pending' && onMultiSelect) {
      const selected = Array.from(checkedIndices).sort((a, b) => a - b);
      onMultiSelect(selected);
    }
  };

  const canConfirm = checkedIndices.size >= minSelections && (!maxSelections || checkedIndices.size <= maxSelections);

  // Multi-select mode
  if (multiSelect) {
    return (
      <div className="interactive-card" data-state={state}>
        <p className="interactive-card-text">{message}</p>

        <div className="interactive-card-multiselect">
          {buttons.map((button, index) => {
            const isChecked = state === 'responded'
              ? selectedIndices?.includes(index) ?? false
              : checkedIndices.has(index);

            return (
              <label
                key={index}
                className={`interactive-card-checkbox-item ${state !== 'pending' ? 'disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={state !== 'pending'}
                  onChange={() => handleCheckboxChange(index)}
                  className="interactive-card-checkbox"
                />
                <span className="interactive-card-checkbox-label">{button.label}</span>
                {isChecked && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="interactive-card-checkbox-check"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8l4 4 6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </label>
            );
          })}
        </div>

        {state === 'pending' && (
          <button
            className="interactive-card-confirm-btn"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Confirm ({checkedIndices.size} selected)
          </button>
        )}

        {state === 'expired' && (
          <span className="interactive-card-expired">Expired</span>
        )}
      </div>
    );
  }

  // Single-select mode (existing behavior)
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
              onClick={() => handleSingleClick(index)}
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
