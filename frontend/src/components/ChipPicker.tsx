import React from 'react';
import './ChipPicker.css';

interface ChipPickerProps {
  label: string;
  items: string[];
  available: Array<{ name: string; label?: string }>;
  onChange: (items: string[]) => void;
  placeholder?: string;
}

export const ChipPicker: React.FC<ChipPickerProps> = ({
  label,
  items,
  available,
  onChange,
  placeholder = 'Select...',
}) => {
  const handleRemove = (item: string) => {
    onChange(items.filter((i) => i !== item));
  };

  const handleAdd = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value && !items.includes(value)) {
      onChange([...items, value]);
    }
  };

  const availableOptions = available.filter((opt) => !items.includes(opt.name));

  return (
    <div className="chip-picker">
      <div className="chip-picker-label">{label}</div>
      <div className="chip-picker-content">
        {items.length > 0 && (
          <div className="chip-picker-chips">
            {items.map((item) => (
              <span key={item} className="chip-picker-chip">
                {item}
                <button
                  type="button"
                  className="chip-picker-remove"
                  onClick={() => handleRemove(item)}
                  aria-label={`Remove ${item}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {availableOptions.length > 0 && (
          <select
            className="chip-picker-select"
            onChange={handleAdd}
            value=""
          >
            <option value="" disabled>
              {placeholder}
            </option>
            {availableOptions.map((opt) => (
              <option key={opt.name} value={opt.name}>
                {opt.label || opt.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
};
