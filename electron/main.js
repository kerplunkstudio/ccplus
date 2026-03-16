const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const Store = require('electron-store');
const fs = require('fs');

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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
    show: false, // Don't show until ready
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createMenu();
}

// Create application menu
function createMenu() {
  const isMac = process.platform === 'darwin';

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
  await shell.openExternal(url);
});
