# Desktop App Testing Guide

## Quick Test

To verify the desktop app works correctly:

### 1. Launch the app

```bash
./deploy.sh desktop
```

Or:

```bash
./ccplus-desktop
```

### 2. Expected behavior

- Electron window should open (not a browser tab)
- Window title: "cc+ Desktop"
- UI should load at localhost:4000
- Flask server and SDK worker start automatically in background
- Activity tree and chat interface should be functional

### 3. Verify window features

- **Resize**: Window should be resizable (minimum 1000x600)
- **Menu bar**: Native menus should appear (File, Edit, View, Window, Help)
- **DevTools**: View > Toggle DevTools should work
- **State persistence**: Close and reopen - window should remember size/position

### 4. Verify backend integration

- Send a test message in chat
- Activity tree should show tool events
- Backend processes should be visible:
  ```bash
  ps aux | grep "python.*server.py"
  ps aux | grep "python.*sdk_worker.py"
  ```

### 5. Clean shutdown

- Close the app window
- Verify processes stopped:
  ```bash
  lsof -ti:4000  # Should return nothing
  ls data/sdk_worker.sock  # Should not exist
  ```

## Troubleshooting

### App won't start

Check logs:
```bash
tail -f logs/server.log
tail -f logs/worker.log
```

### Frontend not loading

Build frontend first:
```bash
./deploy.sh frontend
```

### Port 4000 in use

Kill existing processes:
```bash
./deploy.sh stop
```

Or use a different port:
```bash
PORT=5000 ./ccplus-desktop
```

### Backend processes remain after quit

Manual cleanup:
```bash
./deploy.sh stop
```

## Building distributables

### macOS

```bash
npm run package:mac
```

Output: `dist/cc+ Desktop.dmg` and `dist/cc+ Desktop.app.zip`

### Linux

```bash
npm run package:linux
```

Output: `dist/cc+ Desktop.AppImage` and `dist/cc+ Desktop.deb`

### Windows

```bash
npm run package:win
```

Output: `dist/cc+ Desktop Setup.exe` and portable version

## Development mode

For debugging with DevTools auto-open:

```bash
ELECTRON_IS_DEV=1 npm run electron
```

## Icon customization

1. Create icons:
   - macOS: 512x512+ PNG → convert to .icns
   - Linux: 512x512 PNG
   - Windows: 256x256+ PNG → convert to .ico

2. Place in `electron/assets/`:
   - `icon.icns`
   - `icon.png`
   - `icon.ico`

3. Rebuild package:
   ```bash
   npm run package:mac  # or linux/win
   ```

## Notes

- Desktop app and web UI cannot run simultaneously (both use port 4000)
- Desktop app manages its own Flask + worker instances
- Closing the desktop window stops all backend processes
- Window state stored in `~/Library/Application Support/ccplus/config.json` (macOS)
