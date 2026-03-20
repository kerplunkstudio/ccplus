import React from 'react';
import './InsightsPanel.css';
import { SectionLabel } from './InsightsPanel';

interface RateLimitEventData {
  timestamp: string;
  session_id: string;
  retry_after_ms: number;
}

interface SessionTokenData {
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  tool_count: number;
  label: string;
}

interface DailyData {
  date: string;
  queries: number;
  tool_calls: number;
  cost: number;
  input_tokens: number;
  output_tokens: number;
  sessions: number;
}

interface InsightsTokenSectionsProps {
  daily: DailyData[];
  selectedDays: number;
  rateLimitEvents?: RateLimitEventData[];
  totalRateLimits?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cacheHitRate?: number;
  sessionData?: SessionTokenData[];
}

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};


export const InsightsTokenSections: React.FC<InsightsTokenSectionsProps> = ({
  daily,
  selectedDays,
  rateLimitEvents,
  totalRateLimits,
  cacheReadTokens,
  cacheCreationTokens,
  cacheHitRate,
  sessionData,
}) => {
  const maxTokens = Math.max(...daily.map(d => d.input_tokens + d.output_tokens), 1);
  const showCache = cacheReadTokens !== undefined &&
                    cacheCreationTokens !== undefined &&
                    (cacheReadTokens + cacheCreationTokens > 0);

  return (
    <>
      {/* DAILY TOKEN CONSUMPTION */}
      <div className="insights-section">
        <SectionLabel label="DAILY TOKEN CONSUMPTION" tooltip="Stacked chart showing input and output tokens consumed per day. Input tokens include only non-cached tokens (new context)." />
        <div className="insights-token-stacked-chart">
          <div className="insights-chart-y-axis">
            <span className="insights-y-label">{formatNumber(maxTokens)}</span>
            <span className="insights-y-label">{formatNumber(Math.floor(maxTokens * 0.75))}</span>
            <span className="insights-y-label">{formatNumber(Math.floor(maxTokens * 0.5))}</span>
            <span className="insights-y-label">{formatNumber(Math.floor(maxTokens * 0.25))}</span>
            <span className="insights-y-label">0</span>
          </div>
          <div className="insights-token-stacked-bars">
            {daily.map((day) => {
              const totalTokens = day.input_tokens + day.output_tokens;
              const inputHeight = Math.max((day.input_tokens / maxTokens) * 100, 0.5);
              const outputHeight = Math.max((day.output_tokens / maxTokens) * 100, 0.5);
              const localDate = new Date(day.date + 'T12:00:00');
              const tooltipLabel = localDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

              return (
                <div key={day.date} className="insights-token-stacked-wrapper">
                  <div className="insights-token-stacked-bar">
                    <div
                      className="insights-token-stacked-input"
                      style={{ height: `${inputHeight}%` }}
                      data-tooltip={`${tooltipLabel} · ${formatNumber(day.input_tokens)} input · ${formatNumber(day.output_tokens)} output · ${formatNumber(totalTokens)} total`}
                    />
                    <div
                      className="insights-token-stacked-output"
                      style={{ height: `${outputHeight}%` }}
                      data-tooltip={`${tooltipLabel} · ${formatNumber(day.input_tokens)} input · ${formatNumber(day.output_tokens)} output · ${formatNumber(totalTokens)} total`}
                    />
                  </div>
                  <div className="insights-bar-label">
                    {localDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="insights-chart-legend" style={{ marginTop: 'var(--space-md)' }}>
          <span className="insights-legend-item">
            <span className="insights-legend-dot insights-legend-token-input" />
            Input tokens
          </span>
          <span className="insights-legend-item">
            <span className="insights-legend-dot insights-legend-token-output" />
            Output tokens
          </span>
        </div>
      </div>

      {/* RATE LIMIT EVENTS */}
      {totalRateLimits != null && totalRateLimits > 0 && (
        <div className="insights-section">
          <SectionLabel label="RATE LIMIT EVENTS" tooltip="Number of times the API rate limiter was hit during the period." />
          <div className="insights-rate-limit-summary">
            {totalRateLimits} events in {selectedDays} days
          </div>
        </div>
      )}

      {/* CACHE EFFICIENCY */}
      {showCache && (
        <div className="insights-section">
          <SectionLabel label="CACHE EFFICIENCY" tooltip="Percentage of input tokens served from Anthropic's prompt cache vs sent fresh. Higher is better — cached tokens cost 90% less. Formula: cache_read / (cache_read + new_input)." />
          <div className="insights-cache-hit-rate">
            {cacheHitRate !== undefined
              ? `${cacheHitRate.toFixed(1)}%`
              : '0%'}
          </div>
          <div className="insights-cache-label">cache hit rate</div>
          <div className="insights-cache-bar">
            {(() => {
              const cacheRead = cacheReadTokens || 0;
              const cacheCreation = cacheCreationTokens || 0;
              const total = cacheRead + cacheCreation;
              const readPct = total > 0 ? (cacheRead / total) * 100 : 0;
              const creationPct = total > 0 ? (cacheCreation / total) * 100 : 0;

              return (
                <>
                  <div className="insights-cache-read" style={{ width: `${readPct}%` }}>
                    <span className="insights-cache-text">{formatNumber(cacheRead)} read</span>
                  </div>
                  <div className="insights-cache-creation" style={{ width: `${creationPct}%` }}>
                    <span className="insights-cache-text">{formatNumber(cacheCreation)} creation</span>
                  </div>
                </>
              );
            })()}
          </div>
          <div className="insights-cache-ratio">
            Read {cacheReadTokens ? formatNumber(cacheReadTokens) : 0} · Creation {cacheCreationTokens ? formatNumber(cacheCreationTokens) : 0}
          </div>
        </div>
      )}

      {/* TOP SESSIONS BY TOKEN USAGE */}
      {sessionData && sessionData.length > 0 && (
        <div className="insights-section">
          <SectionLabel label="TOP SESSIONS BY TOKEN USAGE" tooltip="Sessions ranked by total token consumption (input + output). Helps identify which conversations used the most resources." />
          <div className="insights-table">
            <div className="insights-table-header insights-table-header-sessions">
              <div className="insights-table-cell insights-table-cell-session">Session</div>
              <div className="insights-table-cell insights-table-cell-session-input">Input</div>
              <div className="insights-table-cell insights-table-cell-session-output">Output</div>
              <div className="insights-table-cell insights-table-cell-session-total">Total</div>
            </div>
            {(() => {
              const maxTotal = Math.max(...sessionData.map(s => s.input_tokens + s.output_tokens), 1);
              return sessionData.slice(0, 10).map((session) => {
                const totalTokens = session.input_tokens + session.output_tokens;
                const barWidth = (totalTokens / maxTotal) * 100;
                const sessionLabel = session.label.length > 40
                  ? session.label.substring(0, 40) + '...'
                  : session.label;

                return (
                  <div key={session.session_id} className="insights-table-row insights-table-row-sessions">
                    <div className="insights-table-cell insights-table-cell-session" title={session.label}>
                      <div className="insights-session-bar-bg">
                        <div className="insights-session-bar" style={{ width: `${barWidth}%` }} />
                      </div>
                      <span className="insights-session-label">{sessionLabel}</span>
                    </div>
                    <div className="insights-table-cell insights-table-cell-session-input">
                      {formatNumber(session.input_tokens)}
                    </div>
                    <div className="insights-table-cell insights-table-cell-session-output">
                      {formatNumber(session.output_tokens)}
                    </div>
                    <div className="insights-table-cell insights-table-cell-session-total">
                      {formatNumber(totalTokens)}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </>
  );
};
