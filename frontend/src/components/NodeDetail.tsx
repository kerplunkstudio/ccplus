import React from 'react';
import { ActivityNode, isAgentNode, AgentNode, ToolNode } from '../types';
import { ToolIcon } from './ToolIcon';
import './NodeDetail.css';

interface NodeDetailProps {
  node: ActivityNode;
  onClose: () => void;
}

const formatDuration = (ms?: number): string => {
  if (ms === undefined) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const className = `detail-status-badge detail-status-${status}`;
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={className}>{label}</span>;
};

const AgentDetail: React.FC<{ node: AgentNode }> = ({ node }) => {
  const toolCount = node.children.filter((child) => !isAgentNode(child)).length;
  const agentCount = node.children.filter((child) => isAgentNode(child)).length;

  return (
    <div className="node-detail-content">
      <div className="detail-header">
        <div className="detail-header-icon">
          <ToolIcon toolName="Agent" size={24} />
        </div>
        <div className="detail-header-info">
          <div className="detail-header-label">Agent</div>
          <div className="detail-header-title">{node.agent_type}</div>
        </div>
        <StatusBadge status={node.status} />
      </div>

      {node.description && (
        <div className="detail-section">
          <div className="detail-section-title">Description</div>
          <div className="detail-section-content detail-description">
            {node.description}
          </div>
        </div>
      )}

      <div className="detail-section">
        <div className="detail-section-title">Metadata</div>
        <div className="detail-metadata">
          <div className="detail-metadata-row">
            <span className="detail-metadata-label">Started</span>
            <span className="detail-metadata-value">{formatTimestamp(node.timestamp)}</span>
          </div>
          <div className="detail-metadata-row">
            <span className="detail-metadata-label">Duration</span>
            <span className="detail-metadata-value">{formatDuration(node.duration_ms)}</span>
          </div>
          <div className="detail-metadata-row">
            <span className="detail-metadata-label">Status</span>
            <span className="detail-metadata-value">{node.status}</span>
          </div>
          <div className="detail-metadata-row">
            <span className="detail-metadata-label">ID</span>
            <span className="detail-metadata-value detail-mono">{node.tool_use_id}</span>
          </div>
        </div>
      </div>

      {node.children.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">Operations</div>
          <div className="detail-section-content">
            <div className="detail-stats">
              <div className="detail-stat">
                <div className="detail-stat-value">{toolCount}</div>
                <div className="detail-stat-label">Tool{toolCount !== 1 ? 's' : ''}</div>
              </div>
              <div className="detail-stat">
                <div className="detail-stat-value">{agentCount}</div>
                <div className="detail-stat-label">Agent{agentCount !== 1 ? 's' : ''}</div>
              </div>
              <div className="detail-stat">
                <div className="detail-stat-value">{node.children.length}</div>
                <div className="detail-stat-label">Total</div>
              </div>
            </div>

            <div className="detail-timeline">
              {node.children.map((child, index) => (
                <div key={child.tool_use_id} className="detail-timeline-item">
                  <div className="detail-timeline-marker">
                    <span className="detail-timeline-dot" />
                    {index < node.children.length - 1 && (
                      <span className="detail-timeline-line" />
                    )}
                  </div>
                  <div className="detail-timeline-content">
                    <div className="detail-timeline-icon">
                      <ToolIcon
                        toolName={isAgentNode(child) ? 'Agent' : child.tool_name}
                        size={12}
                      />
                    </div>
                    <span className="detail-timeline-name">
                      {isAgentNode(child) ? child.agent_type : child.tool_name}
                    </span>
                    <span className="detail-timeline-time">
                      {formatTimestamp(child.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {node.error && (
        <div className="detail-section">
          <div className="detail-section-title">Error</div>
          <div className="detail-error">{node.error}</div>
        </div>
      )}
    </div>
  );
};

const ToolDetail: React.FC<{ node: ToolNode }> = ({ node }) => {
  const paramEntries = node.parameters ? Object.entries(node.parameters) : [];

  return (
    <div className="node-detail-content">
      <div className="detail-header">
        <div className="detail-header-icon">
          <ToolIcon toolName={node.tool_name} size={24} />
        </div>
        <div className="detail-header-info">
          <div className="detail-header-label">Tool</div>
          <div className="detail-header-title">{node.tool_name}</div>
        </div>
        <StatusBadge status={node.status} />
      </div>

      <div className="detail-section">
        <div className="detail-section-title">Metadata</div>
        <div className="detail-metadata">
          <div className="detail-metadata-row">
            <span className="detail-metadata-label">Started</span>
            <span className="detail-metadata-value">{formatTimestamp(node.timestamp)}</span>
          </div>
          <div className="detail-metadata-row">
            <span className="detail-metadata-label">Duration</span>
            <span className="detail-metadata-value">{formatDuration(node.duration_ms)}</span>
          </div>
          <div className="detail-metadata-row">
            <span className="detail-metadata-label">Status</span>
            <span className="detail-metadata-value">{node.status}</span>
          </div>
          <div className="detail-metadata-row">
            <span className="detail-metadata-label">ID</span>
            <span className="detail-metadata-value detail-mono">{node.tool_use_id}</span>
          </div>
        </div>
      </div>

      {paramEntries.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">Parameters</div>
          <div className="detail-params">
            {paramEntries.map(([key, value]) => {
              const stringValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
              const isLongValue = stringValue.length > 100;
              const isCode = key === 'command' || key === 'content' || key === 'pattern';

              return (
                <div key={key} className="detail-param">
                  <div className="detail-param-key">{key}</div>
                  <div className={`detail-param-value ${isCode ? 'detail-code' : ''}`}>
                    {isCode ? (
                      <pre className="detail-code-block">{stringValue}</pre>
                    ) : (
                      <span title={isLongValue ? stringValue : undefined}>
                        {isLongValue ? `${stringValue.slice(0, 100)}...` : stringValue}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {node.error && (
        <div className="detail-section">
          <div className="detail-section-title">Error</div>
          <div className="detail-error">{node.error}</div>
        </div>
      )}
    </div>
  );
};

export const NodeDetail: React.FC<NodeDetailProps> = ({ node, onClose }) => {
  return (
    <div className="node-detail-overlay">
      <div className="node-detail-panel">
        <div className="node-detail-header">
          <button
            className="node-detail-back"
            onClick={onClose}
            aria-label="Close detail panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Back</span>
          </button>
        </div>

        {isAgentNode(node) ? <AgentDetail node={node} /> : <ToolDetail node={node} />}
      </div>
    </div>
  );
};
