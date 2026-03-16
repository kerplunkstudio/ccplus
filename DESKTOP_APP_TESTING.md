# Desktop App Testing Guide

## Quick Test

To verify the desktop app works correctly:

### 1. Launch the app

```bash
./ccplus desktop
```

Or:

```bash
./ccplus-desktop
```

### 2. Expected behavior

- Electron window should open (not a browser tab)
- Window title: "cc+ Desktop"
- UI should load at localhost:4000
- Node.js server starts automatically in background
- Activity tree and chat interface should be functional

### 3. Verify window features

- **Resize**: Window should be resizable (minimum 1000x600)
- **Menu bar**: Native menus should appear (File, Edit, View, Window, Help)
- **DevTools**: View > Toggle DevTools should work
- **State persistence**: Close and reopen - window should remember size/position

### 4. Verify backend integration

- Send a test message in chat
- Activity tree should show tool events
- Backend process should be visible:
  ```bash
  lsof -ti:4000
  ```

### 5. Clean shutdown

- Close the app window
- Verify process stopped:
  ```bash
  lsof -ti:4000  # Should return nothing
  ```

## Troubleshooting

### App won't start

Check logs:
```bash
tail -f logs/server.log
```

### Frontend not loading

Build frontend first:
```bash
./ccplus frontend
```

### Port 4000 in use

Kill existing processes:
```bash
./ccplus stop
```

Or use a different port:
```bash
PORT=5000 ./ccplus-desktop
```

### Backend process remains after quit

Manual cleanup:
```bash
./ccplus stop
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

- Desktop app and web UI cannot run simultaneously on the same port (both use port 4000 by default)
- Desktop app manages its own Node.js server instance
- Closing the desktop window stops all backend processes
- Window state stored in `~/Library/Application Support/ccplus/config.json` (macOS)
