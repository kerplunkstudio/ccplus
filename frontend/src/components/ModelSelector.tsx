import React, { useState, useRef, useEffect } from 'react';
import './ModelSelector.css';

const MODELS = [
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet' },
  { id: 'claude-opus-4-20250514', label: 'Opus' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku' },
];

interface ModelSelectorProps {
  selectedModel: string;
  onSelectModel: (model: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onSelectModel,
}) => {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentLabel = MODELS.find((m) => m.id === selectedModel)?.label || selectedModel;

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        className="model-selector-trigger"
        onClick={() => setOpen(!open)}
        title={selectedModel}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <span className="model-selector-label">{currentLabel}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`model-selector-arrow ${open ? 'open' : ''}`}
        >
          <path d="M3 4L5 6L7 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="model-selector-dropdown">
          {MODELS.map((model) => (
            <button
              key={model.id}
              className={`model-selector-item ${selectedModel === model.id ? 'active' : ''}`}
              onClick={() => {
                onSelectModel(model.id);
                setOpen(false);
              }}
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
