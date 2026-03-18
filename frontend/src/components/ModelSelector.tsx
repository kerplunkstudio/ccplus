import React, { useState, useRef, useEffect, useCallback } from 'react';
import './ModelSelector.css';

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet' },
  { id: 'claude-opus-4-6', label: 'Opus' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku' },
];

interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (model: string) => void;
  sessionModel?: string | null;
  isOverridden?: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onSelectModel,
  sessionModel,
  isOverridden = false,
}) => {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && focusedIndex >= 0 && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [open, focusedIndex]);

  const handleOpen = useCallback(() => {
    setOpen(true);
    const currentIndex = MODELS.findIndex((m) => m.id === selectedModel);
    setFocusedIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [selectedModel]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setFocusedIndex(-1);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleOpen();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        handleClose();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % MODELS.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + MODELS.length) % MODELS.length);
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(MODELS.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0) {
          onSelectModel(MODELS[focusedIndex].id);
          handleClose();
        }
        break;
      case 'Tab':
        handleClose();
        break;
    }
  };

  const currentLabel = MODELS.find((m) => m.id === selectedModel)?.label || selectedModel;
  const listboxId = 'model-selector-listbox';

  return (
    <div className="model-selector" ref={dropdownRef} onKeyDown={handleKeyDown}>
      <button
        className={`model-selector-trigger ${isOverridden ? 'overridden' : ''}`}
        onClick={() => (open ? handleClose() : handleOpen())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={`Model: ${currentLabel}${isOverridden ? ' (session override)' : ''}`}
        title={isOverridden ? `Session: ${selectedModel}\nDefault: ${sessionModel || 'N/A'}` : selectedModel}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <span className="model-selector-label">{currentLabel}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`model-selector-arrow ${open ? 'open' : ''}`}
          aria-hidden="true"
        >
          <path d="M3 4L5 6L7 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <div
          className="model-selector-dropdown"
          role="listbox"
          id={listboxId}
          aria-label="Select model"
          aria-activedescendant={focusedIndex >= 0 ? `model-option-${focusedIndex}` : undefined}
          tabIndex={-1}
        >
          {MODELS.map((model, index) => (
            <button
              key={model.id}
              id={`model-option-${index}`}
              ref={(el) => { itemRefs.current[index] = el; }}
              className={`model-selector-item ${selectedModel === model.id ? 'active' : ''} ${focusedIndex === index ? 'focused' : ''}`}
              role="option"
              aria-selected={selectedModel === model.id}
              onClick={() => {
                onSelectModel(model.id);
                handleClose();
              }}
              tabIndex={-1}
            >
              <span className="model-item-label">{model.label}</span>
              <span className="model-item-id">{model.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
