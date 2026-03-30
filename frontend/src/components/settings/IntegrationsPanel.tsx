import React, { useState } from 'react';
import { IntegrationsConfig } from '../../hooks/useSettings';

interface IntegrationsPanelProps {
  config: IntegrationsConfig | null;
  onUpdate: (key: string, value: unknown) => void;
}

export function IntegrationsPanel({ config, onUpdate }: IntegrationsPanelProps) {
  const [telegramTokenVisible, setTelegramTokenVisible] = useState(false);
  const [telegramUserInput, setTelegramUserInput] = useState('');
  if (!config) {
    return (
      <div className="settings-panel">
        <div className="settings-panel-header">
          <h2 className="settings-panel-title">Integrations</h2>
          <p className="settings-panel-description">
            Configure third-party integrations for remote access
          </p>
        </div>
        <div className="settings-row">
          <div className="settings-skeleton" style={{ width: '200px' }} />
        </div>
      </div>
    );
  }

  const handleTelegramUserAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && telegramUserInput.trim()) {
      const newUsers = [...config.telegram.allowedUsers, telegramUserInput.trim()];
      onUpdate('integrations.telegram.allowedUsers', newUsers);
      setTelegramUserInput('');
    }
  };

  const removeTelegramUser = (user: string) => {
    const newUsers = config.telegram.allowedUsers.filter((u) => u !== user);
    onUpdate('integrations.telegram.allowedUsers', newUsers);
  };

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Integrations</h2>
        <p className="settings-panel-description">
          Configure third-party integrations for remote access
        </p>
      </div>

      <h3 className="settings-section-header">Telegram</h3>

      <div className="settings-row">
        <div className="settings-row-label-group">
          <div className="settings-row-label">
            Bot Token
            <span className="settings-restart-badge">· restart required</span>
          </div>
          <div className="settings-row-description">
            Telegram bot API token from @BotFather
          </div>
        </div>
        <div className="settings-row-control">
          <div className="settings-password-wrapper">
            <input
              type={telegramTokenVisible ? 'text' : 'password'}
              className="settings-password-input"
              value={config.telegram.botToken}
              onChange={(e) => onUpdate('integrations.telegram.botToken', e.target.value)}
              placeholder="Enter token..."
            />
            <button
              className="settings-password-toggle"
              onClick={() => setTelegramTokenVisible(!telegramTokenVisible)}
              aria-label={telegramTokenVisible ? 'Hide token' : 'Show token'}
            >
              {telegramTokenVisible ? '👁️' : '👁️‍🗨️'}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label-group">
          <div className="settings-row-label">
            Allowed Users
            <span className="settings-restart-badge">· restart required</span>
          </div>
          <div className="settings-row-description">
            Telegram user IDs authorized to interact with the bot
          </div>
        </div>
        <div className="settings-row-control">
          <div className="settings-tag-input-wrapper">
            {config.telegram.allowedUsers.map((user) => (
              <span key={user} className="settings-tag">
                {user}
                <button
                  className="settings-tag-remove"
                  onClick={() => removeTelegramUser(user)}
                  aria-label={`Remove ${user}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              className="settings-tag-input"
              value={telegramUserInput}
              onChange={(e) => setTelegramUserInput(e.target.value)}
              onKeyDown={handleTelegramUserAdd}
              placeholder="Add user ID..."
            />
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label-group">
          <div className="settings-row-label">
            Typing Indicator Interval
            <span className="settings-restart-badge">· restart required</span>
          </div>
          <div className="settings-row-description">
            How often to send typing indicator (ms)
          </div>
        </div>
        <div className="settings-row-control">
          <input
            type="number"
            className="settings-number-input"
            value={config.telegram.typingInterval}
            onChange={(e) => onUpdate('integrations.telegram.typingInterval', Number(e.target.value))}
            min={1000}
            max={10000}
            step={500}
          />
        </div>
      </div>

      {/* TODO: Discord integration not yet implemented */}
    </div>
  );
}
