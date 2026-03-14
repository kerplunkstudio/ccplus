const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const Store = require('electron-store');
const fs = require('fs');

const store = new Store();
const isDev = process.env.ELECTRON_IS_DEV === '1';

// Configuration
const SERVER_PORT = process.env.PORT || 4000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

let mainWindow = null;
let serverProcess = null;
let workerProcess = null;

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

// Start Flask server and SDK worker
async function startBackend() {
  return new Promise((resolve, reject) => {
    console.log('[Backend] Starting backend from:', PROJECT_ROOT);

    // Determine Python executable
    const venvPython = path.join(PROJECT_ROOT, 'venv', 'bin', 'python');
    const pythonExec = fs.existsSync(venvPython) ? venvPython : 'python3';

    console.log('[Backend] Using Python:', pythonExec);

    // Ensure required directories exist
    const dataDir = path.join(PROJECT_ROOT, 'data');
    const logsDir = path.join(PROJECT_ROOT, 'logs');

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Check if worker is already running (parallel mode)
    const workerSocket = path.join(PROJECT_ROOT, 'data', 'sdk_worker.sock');
    if (fs.existsSync(workerSocket)) {
      console.log('[Worker] Already running (parallel mode), skipping worker start');
      // Go straight to Flask server
      startFlaskServer(pythonExec, resolve, reject);
      return;
    }

    // Start SDK worker first
    const workerScript = path.join(PROJECT_ROOT, 'backend', 'sdk_worker.py');
    console.log('[Worker] Starting SDK worker from:', workerScript);

    workerProcess = spawn(pythonExec, [workerScript], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: PROJECT_ROOT,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    workerProcess.stdout.on('data', (data) => {
      console.log(`[Worker] ${data.toString().trim()}`);
    });

    workerProcess.stderr.on('data', (data) => {
      console.error(`[Worker] ${data.toString().trim()}`);
    });

    workerProcess.on('error', (error) => {
      console.error('[Worker] Failed to start:', error);
    });

    // Wait for worker socket to be available
    let workerWaitTime = 0;
    const workerCheckInterval = setInterval(() => {
      if (fs.existsSync(workerSocket)) {
        clearInterval(workerCheckInterval);
        console.log('[Worker] Ready');

        // Start Flask server
        startFlaskServer(pythonExec, resolve, reject);
      } else {
        workerWaitTime += 500;
        if (workerWaitTime > 10000) {
          clearInterval(workerCheckInterval);
          reject(new Error('SDK worker failed to start within 10 seconds'));
        }
      }
    }, 500);
  });
}

function startFlaskServer(pythonExec, resolve, reject) {
  const serverScript = path.join(PROJECT_ROOT, 'backend', 'server.py');
  console.log('[Server] Starting Flask server from:', serverScript);

  serverProcess = spawn(pythonExec, [serverScript], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: PROJECT_ROOT,
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
    if (output.includes('Running on') || output.includes('WARNING')) {
      clearTimeout(serverTimeout);
      onServerReady();
    }
  });

  serverProcess.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(`[Server] ${output.trim()}`);

    // Flask-SocketIO outputs "Running on" to stderr, not stdout
    if (output.includes('Running on') || output.includes('WARNING')) {
      clearTimeout(serverTimeout);
      onServerReady();
    }
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
}

// Stop backend processes
function stopBackend() {
  console.log('[Backend] Stopping backend processes...');

  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }

  if (workerProcess) {
    workerProcess.kill();
    workerProcess = null;
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
    title: 'cc+ Desktop',
    backgroundColor: '#18181b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
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

    // Open DevTools in development
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
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
        isMac ? { role: 'close' } : { role: 'quit' },
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
