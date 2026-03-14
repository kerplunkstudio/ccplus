# Electron Assets

## Icon Files

Place your application icons here:

- `icon.icns` - macOS icon (512x512 or larger)
- `icon.png` - Linux icon (512x512 PNG)
- `icon.ico` - Windows icon (256x256 or larger)

## Generating Icons

You can use tools like:
- [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder)
- [electron-icon-maker](https://www.npmjs.com/package/electron-icon-maker)
- Online tools like [CloudConvert](https://cloudconvert.com/)

Or use the source SVG/PNG and convert:

```bash
# Install icon generator
npm install -g electron-icon-builder

# Generate from a single 1024x1024 PNG
electron-icon-builder --input=icon.png --output=.
```

## Default Icons

If no custom icons are provided, Electron will use default icons.
