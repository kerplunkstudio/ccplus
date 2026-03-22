import React, { useState, useRef, useEffect, useId, KeyboardEvent } from 'react';
import './IntegrationsPanel.css';

interface IntegrationsPanelProps {
  config: {
    telegram: {
      bot_token_set: boolean;
      allowed_users: string[];
      typing_interval_ms: number;
    };
    discord: {
      bot_token_set: boolean;
      allowed_users: string[];
    };
  } | null;
  onUpdate: (key: string, value: unknown) => void;
}

interface TokenFieldProps {
  tokenSet: boolean;
  onSave: (value: string) => void;
  helperText?: string;
  labelId?: string;
}

function TokenField({ tokenSet, onSave, helperText, labelId }: TokenFieldProps) {
  const [editing, setEditing] = useState(!tokenSet);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // Sync editing state when tokenSet prop changes (e.g. after successful save)
  useEffect(() => {
    if (tokenSet) setEditing(false);
  }, [tokenSet]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleChange = () => {
    setEditing(true);
    setDraft('');
  };

  const handleSave = () => {
    if (draft.trim()) {
      onSave(draft.trim());
      setEditing(false);
      setDraft('');
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setDraft('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (tokenSet) {
        handleSave();
      } else if (draft.trim()) {
        onSave(draft.trim());
      }
    }
    if (e.key === 'Escape' && tokenSet) {
      handleCancel();
    }
  };

  if (!editing && tokenSet) {
    return (
      <div className="ip-token-masked-row">
        <span className="ip-token-dots" aria-label="Token set">••••••••</span>
        <button className="ip-btn-secondary" onClick={handleChange}>Change</button>
      </div>
    );
  }

  return (
    <div className="ip-token-edit-row">
      <input
        ref={inputRef}
        id={labelId ?? inputId}
        type="password"
        className="ip-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tokenSet ? 'Enter new token' : ''}
        autoComplete="off"
      />
      {tokenSet ? (
        <>
          <button className="ip-btn-primary" onClick={handleSave}>Save</button>
          <button className="ip-btn-secondary" onClick={handleCancel}>Cancel</button>
        </>
      ) : helperText ? (
        <span className="ip-helper">{helperText}</span>
      ) : null}
    </div>
  );
}

interface TagInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  inputId?: string;
}

function TagInput({ values, onChange, inputId }: TagInputProps) {
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (raw: string) => {
    const trimmed = raw.trim().replace(/,$/, '').trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setInputVal('');
  };

  const removeTag = (tag: string) => {
    onChange(values.filter((v) => v !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputVal);
    }
    if (e.key === 'Backspace' && !inputVal && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.endsWith(',')) {
      addTag(val);
    } else {
      setInputVal(val);
    }
  };

  return (
    <div className="ip-tag-input" onClick={() => inputRef.current?.focus()}>
      {values.map((tag) => (
        <span key={tag} className="ip-tag">
          {tag}
          <button
            className="ip-tag-remove"
            onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
            aria-label={`Remove ${tag}`}
          >
            <span aria-hidden="true">×</span>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={inputId}
        className="ip-tag-input-field"
        value={inputVal}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={values.length === 0 ? 'Add user ID or @username…' : ''}
      />
    </div>
  );
}

export default function IntegrationsPanel({ config, onUpdate }: IntegrationsPanelProps) {
  const telegram = config?.telegram ?? { bot_token_set: false, allowed_users: [], typing_interval_ms: 4000 };
  const discord = config?.discord ?? { bot_token_set: false, allowed_users: [] };

  const tgTokenLabelId = useId();
  const tgUsersLabelId = useId();
  const tgIntervalId = useId();
  const dcTokenLabelId = useId();
  const dcUsersLabelId = useId();

  return (
    <div className="ip-panel">
      <div className="ip-header">
        <h2 className="ip-title">Integrations</h2>
        <p className="ip-description">External services that connect to Captain.</p>
      </div>

      <div className="ip-restart-banner" role="note">
        All integration changes require a restart to take effect
      </div>

      {/* Telegram */}
      <section className="ip-section">
        <h3 className="ip-section-title">Telegram</h3>

        <div className="ip-field">
          <label className="ip-label" htmlFor={tgTokenLabelId}>Bot Token</label>
          <TokenField
            tokenSet={telegram.bot_token_set}
            onSave={(val) => onUpdate('telegram.bot_token', val)}
            helperText="Get a token from @BotFather on Telegram"
            labelId={tgTokenLabelId}
          />
        </div>

        <div className="ip-field">
          <label className="ip-label" htmlFor={tgUsersLabelId}>Allowed Users</label>
          <p className="ip-description-small">
            Telegram user IDs or @usernames that can interact with Captain. Empty = no restriction.
          </p>
          <TagInput
            values={telegram.allowed_users}
            onChange={(vals) => onUpdate('telegram.allowed_users', vals)}
            inputId={tgUsersLabelId}
          />
        </div>

        <div className="ip-field">
          <label className="ip-label" htmlFor={tgIntervalId}>Typing Indicator Interval (ms)</label>
          <p className="ip-description-small">How often to send typing indicator while Captain processes</p>
          <input
            id={tgIntervalId}
            type="number"
            className="ip-input ip-input-number"
            value={telegram.typing_interval_ms}
            min={500}
            step={500}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val >= 500) onUpdate('telegram.typing_interval_ms', val);
            }}
          />
        </div>
      </section>

      <div className="ip-divider" />

      {/* Discord */}
      <section className="ip-section">
        <h3 className="ip-section-title">Discord</h3>

        <div className="ip-field">
          <label className="ip-label" htmlFor={dcTokenLabelId}>Bot Token</label>
          <TokenField
            tokenSet={discord.bot_token_set}
            onSave={(val) => onUpdate('discord.bot_token', val)}
            labelId={dcTokenLabelId}
          />
        </div>

        <div className="ip-field">
          <label className="ip-label" htmlFor={dcUsersLabelId}>Allowed Users</label>
          <p className="ip-description-small">
            Discord user IDs that can interact with Captain via the bot
          </p>
          <TagInput
            values={discord.allowed_users}
            onChange={(vals) => onUpdate('discord.allowed_users', vals)}
            inputId={dcUsersLabelId}
          />
        </div>
      </section>
    </div>
  );
}
