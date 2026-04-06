import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo?: string;
}

interface ErrorInfo {
  componentStack: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo: errorInfo.componentStack });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          gap: '16px',
          padding: '24px',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '48px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--error)',
            fontWeight: 700,
          }}>
            :/
          </div>
          <p style={{ fontSize: '18px' }}>Something went wrong</p>
          <p style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            maxWidth: '400px',
            lineHeight: 1.5,
          }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          {this.state.errorInfo && (
            <details style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              maxWidth: '600px',
              marginTop: '12px',
              textAlign: 'left',
              fontFamily: 'var(--font-mono)',
            }}>
              <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>Stack trace</summary>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'var(--bg-secondary)',
                padding: '8px',
                borderRadius: '4px',
                maxHeight: '200px',
                overflow: 'auto',
              }}>
                {this.state.errorInfo}
              </pre>
            </details>
          )}
          <button
            onClick={this.handleReload}
            style={{
              padding: '8px 20px',
              background: 'var(--accent)',
              color: 'var(--bg-primary)',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              marginTop: '8px',
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
