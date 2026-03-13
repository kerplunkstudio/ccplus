import React, { useEffect } from 'react';
import { Plugin } from '../types';
import { usePlugins } from '../hooks/usePlugins';
import './InstalledPlugins.css';

interface InstalledPluginsProps {
  onClose?: () => void;
}

export const InstalledPlugins: React.FC<InstalledPluginsProps> = ({ onClose }) => {
  const {
    installedPlugins,
    loading,
    error,
    loadInstalled,
    uninstallPlugin,
  } = usePlugins();

  const [uninstalling, setUninstalling] = React.useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = React.useState<string | null>(null);

  useEffect(() => {
    loadInstalled();
  }, [loadInstalled]);

  const handleUninstallClick = (plugin: Plugin) => {
    setConfirmUninstall(plugin.name);
  };

  const handleUninstallConfirm = async (plugin: Plugin) => {
    setConfirmUninstall(null);
    setUninstalling(plugin.name);
    try {
      await uninstallPlugin(plugin.name);
    } finally {
      setUninstalling(null);
    }
  };

  const renderPluginRow = (plugin: Plugin) => {
    const isUninstalling = uninstalling === plugin.name;

    return (
      <tr key={plugin.name} className={isUninstalling ? 'uninstalling' : ''}>
        <td className="plugin-name-cell">
          <div className="plugin-name">{plugin.name}</div>
          <div className="plugin-description">{plugin.description}</div>
        </td>
        <td className="plugin-version">{plugin.version}</td>
        <td className="plugin-author">{plugin.author.name}</td>
        <td className="plugin-resources">
          <div className="resources-list">
            {plugin.agents && plugin.agents.length > 0 && (
              <span className="resource-badge">
                {plugin.agents.length} agent{plugin.agents.length > 1 ? 's' : ''}
              </span>
            )}
            {plugin.skills && plugin.skills.length > 0 && (
              <span className="resource-badge">
                {plugin.skills.length} skill{plugin.skills.length > 1 ? 's' : ''}
              </span>
            )}
            {plugin.commands && plugin.commands.length > 0 && (
              <span className="resource-badge">
                {plugin.commands.length} command{plugin.commands.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </td>
        <td className="plugin-actions">
          <button
            className={`uninstall-btn ${confirmUninstall === plugin.name ? 'confirming' : ''}`}
            onClick={() => {
              if (confirmUninstall === plugin.name) {
                handleUninstallConfirm(plugin);
              } else {
                handleUninstallClick(plugin);
              }
            }}
            onBlur={() => setConfirmUninstall(null)}
            disabled={isUninstalling || loading}
          >
            {isUninstalling ? 'Uninstalling...' : confirmUninstall === plugin.name ? 'Confirm?' : 'Uninstall'}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="installed-plugins">
      <div className="installed-header">
        <h1>Installed Plugins</h1>
        {onClose && (
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="installed-content">
        {loading && installedPlugins.length === 0 ? (
          <div className="loading">Loading plugins...</div>
        ) : installedPlugins.length === 0 ? (
          <div className="no-plugins">
            <p>No plugins installed yet.</p>
            <p>Visit the Plugin Marketplace to browse and install plugins.</p>
          </div>
        ) : (
          <table className="plugins-table">
            <thead>
              <tr>
                <th>Plugin</th>
                <th>Version</th>
                <th>Author</th>
                <th>Resources</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>{installedPlugins.map(renderPluginRow)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
};
