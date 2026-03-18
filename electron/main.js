const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const Store = require('electron-store');
const fs = require('fs');
const net = require('net');

const store = new Store();
const isDev = process.env.ELECTRON_IS_DEV === '1';

// Set app name
app.name = 'CC+';

// Configuration
const SERVER_PORT = process.env.PORT || 4000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

let mainWindow = null;
let serverProcess = null;

// Get project root directory
const getProjectRoot = () => {
  if (isDev) {
    // In development, we're in the project root
    return process.cwd();
  } else {
    // In production, we're bundled inside app.asar
    // Go up from app.asar to the project root
    return path.join(process.resourcesPath, 'app');
  }
};

const PROJECT_ROOT = getProjectRoot();

// Check if port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, '127.0.0.1');
  });
}

// Start Node.js backend
async function startBackend() {
  return new Promise((resolve, reject) => {
    console.log('[Backend] Starting backend from:', PROJECT_ROOT);

    // Ensure required directories exist
    const dataDir = path.join(PROJECT_ROOT, 'data');
    const logsDir = path.join(PROJECT_ROOT, 'logs');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Start Node.js server
    const serverScript = path.join(PROJECT_ROOT, 'backend-ts', 'dist', 'server.js');
    console.log('[Server] Starting Node.js server from:', serverScript);

    serverProcess = spawn('node', [serverScript], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PORT: SERVER_PORT.toString(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let serverReady = false;

    const onServerReady = () => {
      if (!serverReady) {
        serverReady = true;
        setTimeout(() => {
          console.log('[Server] Ready');
          resolve();
        }, 2000); // Give it a moment to fully initialize
      }
    };

    // Timeout fallback in case we miss the ready message
    const serverTimeout = setTimeout(() => {
      if (!serverReady) {
        console.log('[Server] Ready (timeout fallback after 8s)');
        onServerReady();
      }
    }, 8000);

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[Server] ${output.trim()}`);

      // Look for server ready indicator on stdout
      if (output.includes('ccplus server listening on')) {
        clearTimeout(serverTimeout);
        onServerReady();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[Server] ${output.trim()}`);
    });

    serverProcess.on('error', (error) => {
      console.error('[Server] Failed to start:', error);
      clearTimeout(serverTimeout);
      reject(error);
    });

    serverProcess.on('exit', (code, signal) => {
      console.log(`[Server] Exited with code ${code} and signal ${signal}`);
      clearTimeout(serverTimeout);
      if (code !== 0 && code !== null) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

// Stop backend process
function stopBackend() {
  console.log('[Backend] Stopping backend process...');

  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// Create main window
function createWindow() {
  const isLinux = process.platform === 'linux';

  // Restore window state or use defaults
  const windowState = store.get('windowState', {
    width: 1400,
    height: 900,
    x: undefined,
    y: undefined,
  });

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1000,
    minHeight: 600,
    title: 'CC+',
    backgroundColor: '#18181b',
    // Linux: Set icon explicitly (required for taskbar/window decorations)
    ...(isLinux && { icon: path.join(__dirname, 'assets', 'icon.png') }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
    show: false, // Don't show until ready
  });

  // Grant microphone permissions for voice input (Web Speech API)
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'audioCapture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Save window state on close
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    store.set('windowState', {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    });
  });

  // Load the server URL
  mainWindow.loadURL(SERVER_URL);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // DevTools available via View menu or Cmd+Option+I
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const SAFE_PROTOCOLS = ['https:', 'http:', 'mailto:'];
    try {
      const parsedUrl = new URL(url);
      if (SAFE_PROTOCOLS.includes(parsedUrl.protocol)) {
        shell.openExternal(url);
      }
    } catch (err) {
      console.warn('[Security] Blocked invalid URL:', url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Suppress noisy webview load errors (e.g., when a browser tab URL is unreachable)
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // ERR_ABORTED — silently ignore
      console.warn(`[Webview] Load failed: ${errorDescription} (${errorCode}) for ${validatedURL}`);
    });
  });

  // Create application menu
  createMenu();
}

// Create application menu
function createMenu() {
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'new-tab');
            }
          },
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-action', 'close-tab');
            }
          },
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' },
        ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' },
        ] : [
          { role: 'close' },
        ]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'GitHub Repository',
          click: async () => {
            await shell.openExternal('https://github.com/mjfuentes/ccplus');
          },
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/mjfuentes/ccplus/issues');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App ready
app.whenReady().then(async () => {
  console.log('[App] Starting cc+ Desktop...');
  console.log('[App] Project root:', PROJECT_ROOT);

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    try {
      const { nativeImage } = require('electron');
      const iconPath = path.join(__dirname, 'assets', 'icon.png');
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    } catch (err) {
      console.warn('[App] Could not set dock icon:', err.message);
    }
  }

  // Set app icon on Linux (for notifications, alt-tab, etc.)
  if (process.platform === 'linux') {
    try {
      const { nativeImage } = require('electron');
      const iconPath = path.join(__dirname, 'assets', 'icon.png');
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        // No dock on Linux, but this helps with window manager icons
        console.log('[App] Linux icon loaded from:', iconPath);
      }
    } catch (err) {
      console.warn('[App] Could not load Linux icon:', err.message);
    }
  }

  // Check if port is available before starting backend
  console.log(`[App] Checking if port ${SERVER_PORT} is available...`);
  const portAvailable = await isPortAvailable(SERVER_PORT);

  if (!portAvailable) {
    console.error(`[App] Port ${SERVER_PORT} is already in use`);
    dialog.showErrorBox(
      'Port Already in Use',
      `cc+ cannot start because port ${SERVER_PORT} is already in use.\n\n` +
      `Please close the application using this port or set a different PORT in your environment variables.`
    );
    app.quit();
    return;
  }

  try {
    await startBackend();
    createWindow();
  } catch (error) {
    console.error('[App] Failed to start:', error);
    app.quit();
  }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Cleanup on quit
app.on('will-quit', () => {
  stopBackend();
});

// Handle IPC messages
ipcMain.handle('get-server-url', () => {
  return SERVER_URL;
});

ipcMain.handle('open-external', async (event, url) => {
  const SAFE_PROTOCOLS = ['https:', 'http:', 'mailto:'];
  try {
    const parsedUrl = new URL(url);
    if (SAFE_PROTOCOLS.includes(parsedUrl.protocol)) {
      await shell.openExternal(url);
    } else {
      console.warn('[Security] Blocked unsafe protocol:', parsedUrl.protocol);
    }
  } catch (err) {
    console.warn('[Security] Blocked invalid URL:', url);
  }
});
