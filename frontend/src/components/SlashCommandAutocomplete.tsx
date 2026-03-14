import React, { useEffect, useRef } from 'react';
import { SkillSuggestion } from '../utils/slashCommands';
import './SlashCommandAutocomplete.css';

interface SlashCommandAutocompleteProps {
  suggestions: SkillSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: SkillSuggestion) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export const SlashCommandAutocomplete: React.FC<SlashCommandAutocompleteProps> = ({
  suggestions,
  selectedIndex,
  onSelect,
  onClose,
  inputRef,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedItemRef.current && listRef.current) {
      const item = selectedItemRef.current;
      const list = listRef.current;

      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;
      const listTop = list.scrollTop;
      const listBottom = listTop + list.clientHeight;

      if (itemTop < listTop) {
        list.scrollTop = itemTop;
      } else if (itemBottom > listBottom) {
        list.scrollTop = itemBottom - list.clientHeight;
      }
    }
  }, [selectedIndex]);

  // Position the autocomplete relative to the textarea
  const getPosition = () => {
    if (!inputRef.current) {
      return { top: 0, left: 0 };
    }

    const rect = inputRef.current.getBoundingClientRect();
    return {
      bottom: `calc(100% - ${rect.top}px + 8px)`,
      left: `${rect.left}px`,
      width: `${Math.min(rect.width, 400)}px`,
    };
  };

  if (suggestions.length === 0) {
    return null;
  }

  const position = getPosition();

  return (
    <div
      className="slash-autocomplete"
      style={position}
      role="listbox"
      aria-label="Slash command suggestions"
    >
      <div className="slash-autocomplete-list" ref={listRef}>
        {suggestions.map((suggestion, index) => (
          <div
            key={`${suggestion.plugin}-${suggestion.name}`}
            ref={index === selectedIndex ? selectedItemRef : null}
            className={`slash-autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
            onClick={() => onSelect(suggestion)}
            onMouseEnter={() => {
              // Update selected index on hover (handled by parent)
            }}
            role="option"
            aria-selected={index === selectedIndex}
          >
            <div className="slash-autocomplete-item-header">
              <span className="slash-autocomplete-command">/{suggestion.name}</span>
              <span className="slash-autocomplete-plugin">{suggestion.plugin}</span>
            </div>
            {suggestion.description && (
              <div className="slash-autocomplete-description">
                {suggestion.description}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="slash-autocomplete-footer">
        <kbd>↑</kbd>
        <kbd>↓</kbd> navigate
        <kbd>↵</kbd>
        <kbd>Tab</kbd> select
        <kbd>Esc</kbd> close
      </div>
    </div>
  );
};
