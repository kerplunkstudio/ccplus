import React, { useEffect, useRef } from 'react';
import './PathAutocomplete.css';

interface PathEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface PathAutocompleteProps {
  entries: PathEntry[];
  selectedIndex: number;
  onSelect: (entry: PathEntry) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export const PathAutocomplete: React.FC<PathAutocompleteProps> = ({
  entries,
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
      width: `${Math.min(rect.width, 500)}px`,
    };
  };

  if (entries.length === 0) {
    return null;
  }

  const position = getPosition();

  return (
    <div
      className="path-autocomplete"
      style={position}
      role="listbox"
      aria-label="Path suggestions"
    >
      <div className="path-autocomplete-list" ref={listRef}>
        {entries.map((entry, index) => (
          <div
            key={entry.path}
            ref={index === selectedIndex ? selectedItemRef : null}
            className={`path-autocomplete-item ${index === selectedIndex ? 'selected' : ''}`}
            onClick={() => onSelect(entry)}
            role="option"
            aria-selected={index === selectedIndex}
          >
            <span className="path-icon">
              {entry.isDir ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              )}
            </span>
            <span className="path-name">{entry.name}</span>
          </div>
        ))}
      </div>
      <div className="path-autocomplete-footer">
        <kbd>↑</kbd>
        <kbd>↓</kbd> navigate
        <kbd>Tab</kbd> select
        <kbd>Esc</kbd> close
      </div>
    </div>
  );
};
