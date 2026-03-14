# cc+ Desktop

Electron wrapper for the cc+ web interface, providing a native desktop app experience.

## Features

- **Standalone app**: No need to open a browser - cc+ runs in its own window
- **Integrated backend**: Flask server and SDK worker start automatically with the app
- **Window state persistence**: Remembers window size and position
- **Native menus**: macOS, Linux, and Windows menu integration
- **Dock integration**: Native app appearance in dock/taskbar
- **Auto-update ready**: Built with electron-builder for easy distribution

## Architecture

The desktop app consists of:

1. **Main process** (`main.js`): Manages the application lifecycle, starts backend processes, creates windows
2. **Preload script** (`preload.js`): Provides secure IPC communication between renderer and main
3. **Renderer process**: The React web UI loaded from the Flask server

## How it works

When you launch the desktop app:

1. Electron starts the main process
2. Main process starts the SDK worker (Python process)
3. Main process starts the Flask server (Python process)
4. Main process creates a browser window pointing to `http://localhost:4000`
5. The React UI loads and connects via WebSocket

When you close the app:

1. Window state is saved
2. Flask server is stopped
3. SDK worker is stopped
4. Electron quits

## Running

### Development mode

```bash
# From project root
./deploy.sh desktop
```

Or manually:

```bash
npm install
ELECTRON_IS_DEV=1 npm run electron
```

### Production mode

```bash
npm run electron
```

## Building distributable packages

### macOS

```bash
npm run package:mac
```

Creates `.dmg` and `.zip` in `dist/` directory.

### Linux

```bash
npm run package:linux
```

Creates `.AppImage` and `.deb` in `dist/` directory.

### Windows

```bash
npm run package:win
```

Creates `.exe` installer and portable version in `dist/` directory.

## Configuration

The desktop app respects the same environment variables as the web version:

- `PORT` - Server port (default: 4000)
- `ANTHROPIC_API_KEY` - Claude API key
- `WORKSPACE_PATH` - Working directory for SDK sessions
- `SDK_MODEL` - Default model (default: sonnet)
- `CCPLUS_AUTH` - Auth mode (default: local)
- `SECRET_KEY` - JWT signing key

Set these in your shell before running the app, or create a `.env` file in the project root.

## Window state

The app saves window size and position in Electron's store:

- **macOS**: `~/Library/Application Support/ccplus/config.json`
- **Linux**: `~/.config/ccplus/config.json`
- **Windows**: `%APPDATA%/ccplus/config.json`

## Development vs Production

In development mode (`ELECTRON_IS_DEV=1`):
- DevTools are opened automatically
- More verbose console logging
- Uses current working directory as project root

In production mode:
- DevTools hidden (can be toggled via View menu)
- Uses bundled resources path
- Cleaner console output

## Troubleshooting

### App won't start

Check logs:
```bash
# Server log
tail -f logs/server.log

# Worker log
tail -f logs/worker.log
```

### Backend processes not stopping

The app should automatically stop Flask and worker when quit. If they persist:

```bash
# From project root
./deploy.sh stop
```

### Port already in use

If port 4000 is occupied:

```bash
# Set different port
PORT=5000 npm run electron
```

### Python not found

Ensure you have a virtual environment set up:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Packaging notes

For distribution:

1. Add custom icons to `electron/assets/`
2. Update `package.json` with app metadata
3. Add code signing certificates (macOS/Windows)
4. Configure auto-update server (optional)
5. Build for target platform

See [electron-builder docs](https://www.electron.build/) for advanced packaging options.
