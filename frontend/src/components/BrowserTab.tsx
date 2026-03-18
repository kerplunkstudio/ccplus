import React, { useState, useRef, useEffect } from 'react';
import { WebViewElement, WebViewLoadFailEvent, WindowWithElectron } from '../types';
import './BrowserTab.css';

interface BrowserTabProps {
  url: string;
  onRegisterCapture?: (captureFn: () => Promise<{ image: string | null; url: string; error?: string }>) => void;
}

export const BrowserTab: React.FC<BrowserTabProps> = ({ url, onRegisterCapture }) => {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webviewRef = useRef<WebViewElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isElectron = !!(window as WindowWithElectron).electronAPI;

  useEffect(() => {
    setCurrentUrl(url);
    setInputUrl(url);
  }, [url]);

  // Register screenshot capture function
  useEffect(() => {
    if (!onRegisterCapture) return;

    const captureFn = async (): Promise<{ image: string | null; url: string; error?: string }> => {
      // In Electron mode with webview
      if (isElectron && webviewRef.current) {
        try {
          const webview = webviewRef.current;
          const nativeImage = await webview.capturePage();
          const dataUrl = nativeImage.toDataURL();
          // Extract base64 data from data URL (remove "data:image/png;base64," prefix)
          const base64Data = dataUrl.split(',')[1];
          return {
            image: base64Data,
            url: webview.getURL(),
          };
        } catch (error) {
          return {
            image: null,
            url: currentUrl,
            error: `Failed to capture webview: ${String(error)}`,
          };
        }
      }

      // In iframe mode (non-Electron) - not supported
      return {
        image: null,
        url: currentUrl,
        error: 'Screenshot capture is only available in the desktop app (Electron mode). This feature requires webview.capturePage() which is not available in iframe mode.',
      };
    };

    onRegisterCapture(captureFn);
  }, [isElectron, currentUrl, onRegisterCapture]);

  useEffect(() => {
    if (!isElectron || !webviewRef.current) return;

    const webview = webviewRef.current;

    const handleLoadStart = () => {
      setIsLoading(true);
      setError(null);
    };

    const handleLoadStop = () => {
      setIsLoading(false);
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
      setCurrentUrl(webview.getURL());
      setInputUrl(webview.getURL());
    };

    const handleLoadFail = (event?: unknown) => {
      setIsLoading(false);
      const failEvent = event as WebViewLoadFailEvent | undefined;
      setError(`Failed to load: ${failEvent?.errorDescription || 'Unknown error'}`);
    };

    webview.addEventListener('did-start-loading', handleLoadStart);
    webview.addEventListener('did-stop-loading', handleLoadStop);
    webview.addEventListener('did-fail-load', handleLoadFail);

    return () => {
      webview.removeEventListener('did-start-loading', handleLoadStart);
      webview.removeEventListener('did-stop-loading', handleLoadStop);
      webview.removeEventListener('did-fail-load', handleLoadFail);
    };
  }, [isElectron]);

  const handleNavigate = (targetUrl: string) => {
    let finalUrl = targetUrl;

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }

    if (isElectron && webviewRef.current) {
      webviewRef.current.loadURL(finalUrl);
    } else {
      setCurrentUrl(finalUrl);
    }
    setInputUrl(finalUrl);
    setError(null);
  };

  const handleGoBack = () => {
    if (isElectron && webviewRef.current && webviewRef.current.canGoBack()) {
      webviewRef.current.goBack();
    }
  };

  const handleGoForward = () => {
    if (isElectron && webviewRef.current && webviewRef.current.canGoForward()) {
      webviewRef.current.goForward();
    }
  };

  const handleRefresh = () => {
    if (isElectron && webviewRef.current) {
      webviewRef.current.reload();
    } else if (iframeRef.current) {
      const temp = currentUrl;
      setCurrentUrl('about:blank');
      setTimeout(() => setCurrentUrl(temp), 10);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleNavigate(inputUrl);
  };

  const handleOpenExternal = () => {
    const electronAPI = (window as WindowWithElectron).electronAPI;
    if (electronAPI?.openExternal) {
      electronAPI.openExternal(currentUrl);
    } else {
      window.open(currentUrl, '_blank');
    }
  };

  return (
    <div className="browser-tab">
      <div className="browser-toolbar">
        <div className="browser-nav-buttons">
          <button
            className="browser-nav-btn"
            onClick={handleGoBack}
            disabled={!canGoBack}
            aria-label="Go back"
            title="Go back"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            className="browser-nav-btn"
            onClick={handleGoForward}
            disabled={!canGoForward}
            aria-label="Go forward"
            title="Go forward"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
          <button
            className="browser-nav-btn"
            onClick={handleRefresh}
            aria-label="Refresh"
            title="Refresh"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
        </div>
        <form className="browser-address-bar" onSubmit={handleSubmit}>
          <input
            type="text"
            className="browser-url-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Enter URL..."
          />
          <button
            type="submit"
            className="browser-go-btn"
            aria-label="Navigate"
            title="Navigate"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </form>
        <button
          className="browser-external-btn"
          onClick={handleOpenExternal}
          aria-label="Open in external browser"
          title="Open in external browser"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </button>
      </div>
      {isLoading && (
        <div className="browser-loading-bar">
          <div className="browser-loading-progress" />
        </div>
      )}
      {error && (
        <div className="browser-error">
          <div className="browser-error-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3>Cannot load page</h3>
            <p>{error}</p>
            <button className="browser-error-btn" onClick={handleOpenExternal}>
              Open in external browser
            </button>
          </div>
        </div>
      )}
      <div className="browser-content">
        {isElectron ? (
          <webview
            ref={webviewRef}
            src={currentUrl}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            src={currentUrl}
            title="Browser content"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            onError={() => setError('This page cannot be displayed in an iframe. Some websites block embedding for security reasons.')}
          />
        )}
      </div>
    </div>
  );
};
