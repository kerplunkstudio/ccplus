import React, { useEffect, useState } from 'react';
import { Plugin } from '../types';
import { usePlugins } from '../hooks/usePlugins';
import './PluginMarketplace.css';

interface PluginMarketplaceProps {
  onClose?: () => void;
}

export const PluginMarketplace: React.FC<PluginMarketplaceProps> = ({ onClose }) => {
  const {
    marketplacePlugins,
    loading,
    error,
    loadMarketplace,
    installPlugin,
    uninstallPlugin,
  } = usePlugins();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    loadMarketplace();
  }, [loadMarketplace]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    loadMarketplace(query || undefined);
  };

  const handleInstall = async (plugin: Plugin) => {
    setInstalling(plugin.name);
    try {
      const result = await installPlugin(plugin.repository || plugin.name);
      if (result.success) {
        console.log(`Installed ${plugin.name}`);
      } else {
        console.error(`Failed to install ${plugin.name}:`, result.error);
        alert(`Installation failed: ${result.error}`);
      }
    } catch (err) {
      console.error('Installation error:', err);
    } finally {
      setInstalling(null);
    }
  };

  const handleUninstall = async (plugin: Plugin) => {
    if (!window.confirm(`Uninstall ${plugin.name}?`)) {
      return;
    }

    setInstalling(plugin.name);
    try {
      const result = await uninstallPlugin(plugin.name);
      if (result.success) {
        console.log(`Uninstalled ${plugin.name}`);
      } else {
        console.error(`Failed to uninstall ${plugin.name}:`, result.error);
        alert(`Uninstallation failed: ${result.error}`);
      }
    } catch (err) {
      console.error('Uninstallation error:', err);
    } finally {
      setInstalling(null);
    }
  };

  const renderPluginCard = (plugin: Plugin) => {
    const isInstalling = installing === plugin.name;

    return (
      <div
        key={plugin.name}
        className={`plugin-card ${selectedPlugin?.name === plugin.name ? 'selected' : ''}`}
        onClick={() => setSelectedPlugin(plugin)}
      >
        <div className="plugin-header">
          <h3 className="plugin-name">{plugin.name}</h3>
          <span className="plugin-version">v{plugin.version}</span>
        </div>

        <p className="plugin-description">{plugin.description}</p>

        {plugin.keywords && plugin.keywords.length > 0 && (
          <div className="plugin-keywords">
            {plugin.keywords.slice(0, 3).map((keyword) => (
              <span key={keyword} className="keyword">
                {keyword}
              </span>
            ))}
          </div>
        )}

        <div className="plugin-footer">
          <span className="plugin-author">
            by {plugin.author.name}
          </span>

          <button
            className={`plugin-action-btn ${plugin.installed ? 'uninstall' : 'install'}`}
            onClick={(e) => {
              e.stopPropagation();
              if (plugin.installed) {
                handleUninstall(plugin);
              } else {
                handleInstall(plugin);
              }
            }}
            disabled={isInstalling || loading}
          >
            {isInstalling
              ? 'Processing...'
              : plugin.installed
              ? 'Uninstall'
              : 'Install'}
          </button>
        </div>
      </div>
    );
  };

  const renderPluginDetails = () => {
    if (!selectedPlugin) {
      return (
        <div className="plugin-details-empty">
          <p>Select a plugin to view details</p>
        </div>
      );
    }

    return (
      <div className="plugin-details">
        <div className="plugin-details-header">
          <h2>{selectedPlugin.name}</h2>
          <span className="plugin-version">v{selectedPlugin.version}</span>
        </div>

        <p className="plugin-description-full">{selectedPlugin.description}</p>

        <div className="plugin-meta">
          <div className="meta-item">
            <strong>Author:</strong>{' '}
            {selectedPlugin.author.url ? (
              <a
                href={selectedPlugin.author.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {selectedPlugin.author.name}
              </a>
            ) : (
              selectedPlugin.author.name
            )}
          </div>

          {selectedPlugin.license && (
            <div className="meta-item">
              <strong>License:</strong> {selectedPlugin.license}
            </div>
          )}

          {selectedPlugin.repository && (
            <div className="meta-item">
              <strong>Repository:</strong>{' '}
              <a
                href={selectedPlugin.repository}
                target="_blank"
                rel="noopener noreferrer"
              >
                {selectedPlugin.repository}
              </a>
            </div>
          )}

          {selectedPlugin.homepage && (
            <div className="meta-item">
              <strong>Homepage:</strong>{' '}
              <a
                href={selectedPlugin.homepage}
                target="_blank"
                rel="noopener noreferrer"
              >
                {selectedPlugin.homepage}
              </a>
            </div>
          )}
        </div>

        {selectedPlugin.keywords && selectedPlugin.keywords.length > 0 && (
          <div className="plugin-keywords-full">
            <strong>Keywords:</strong>
            <div className="keywords-list">
              {selectedPlugin.keywords.map((keyword) => (
                <span key={keyword} className="keyword">
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}

        {selectedPlugin.agents && selectedPlugin.agents.length > 0 && (
          <div className="plugin-content-section">
            <strong>Agents:</strong>
            <ul>
              {selectedPlugin.agents.map((agent, idx) => (
                <li key={idx}>{agent}</li>
              ))}
            </ul>
          </div>
        )}

        {selectedPlugin.skills && selectedPlugin.skills.length > 0 && (
          <div className="plugin-content-section">
            <strong>Skills:</strong>
            <ul>
              {selectedPlugin.skills.map((skill, idx) => (
                <li key={idx}>{skill}</li>
              ))}
            </ul>
          </div>
        )}

        {selectedPlugin.commands && selectedPlugin.commands.length > 0 && (
          <div className="plugin-content-section">
            <strong>Commands:</strong>
            <ul>
              {selectedPlugin.commands.map((command, idx) => (
                <li key={idx}>{command}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="plugin-actions">
          <button
            className={`plugin-action-btn ${selectedPlugin.installed ? 'uninstall' : 'install'}`}
            onClick={() => {
              if (selectedPlugin.installed) {
                handleUninstall(selectedPlugin);
              } else {
                handleInstall(selectedPlugin);
              }
            }}
            disabled={installing === selectedPlugin.name || loading}
          >
            {installing === selectedPlugin.name
              ? 'Processing...'
              : selectedPlugin.installed
              ? 'Uninstall Plugin'
              : 'Install Plugin'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="plugin-marketplace">
      <div className="marketplace-header">
        <h1>Plugin Marketplace</h1>
        {onClose && (
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search plugins..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="search-input"
        />
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="marketplace-content">
        <div className="plugins-grid">
          {loading && marketplacePlugins.length === 0 ? (
            <div className="loading">Loading plugins...</div>
          ) : marketplacePlugins.length === 0 ? (
            <div className="no-plugins">No plugins found</div>
          ) : (
            marketplacePlugins.map(renderPluginCard)
          )}
        </div>

        <div className="plugin-details-panel">{renderPluginDetails()}</div>
      </div>
    </div>
  );
};
