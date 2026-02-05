# LookieCookie

Watch cookies, auto-decode their values, and track changes between requests to make debugging easier.

## Features
- Lists cookies for the active tab
- Automatically tracks cookies (no selection)
- Automatically decodes URL-encoded and Base64 values
- Detects JSON payloads and formats them
- Tracks changes via `cookies.onChanged`
- Shows current value and a change history
- JSON/CSV export for cookie history

## Project Structure
- `shared/` is the single source of truth for the extension logic and UI (background, devtools, panel).
- `chrome/`, `firefox/`, and `safari/` contain **manifest overrides only**.
- `dist/` is generated output for each browser build (do not edit manually).

## Development Workflow
1. Edit shared files in `shared/`:
   - `background.js`
   - `devtools.html`, `devtools.js`
   - `panel.html`, `panel.css`, `panel.js`
2. Build browser outputs:
   - `npm run build` (or `node scripts/build.mjs`)
3. Load the extension from `dist/chrome`, `dist/firefox`, or `dist/safari`.

Notes:
- Do not edit files in `dist/` directly.
- `chrome/manifest.json` and `firefox/manifest.json` are **overrides only**; base fields live in `shared/manifest.base.json`.

## Build Script
The build script merges shared assets and manifests into `dist/`:
- `shared/manifest.base.json` + browser override manifest
- Shared UI and background files
- Shared icons (with optional browser overrides)

Command:
- `npm run build`

## Chrome Setup
1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `dist/chrome`.
4. Open a site with cookies, then open DevTools and select the **LookieCookie** panel.

## Firefox Setup
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `dist/firefox/manifest.json`.
4. Open a site with cookies, then open DevTools and select the **LookieCookie** panel.

## Safari Setup
Safari requires an Xcode wrapper project to run web extensions.

### Prerequisites
- macOS 10.14.6 or later
- Xcode (free from Mac App Store)
- Safari 15.4 or later

### Steps
1. Build the extension:
   ```bash
   npm run build
   ```

2. Convert to Safari extension using Xcode's converter:
   ```bash
   xcrun safari-web-extension-converter dist/safari \
     --project-location safari-xcode \
     --app-name "LookieCookie" \
     --bundle-identifier com.example.lookiecookie \
     --no-open
   ```

3. Open the generated Xcode project:
   ```bash
   open safari-xcode/LookieCookie/LookieCookie.xcodeproj
   ```

4. In Xcode:
   - Select a development team (or personal team for testing)
   - Build and run the project (⌘R)

5. Enable the extension in Safari:
   - Open Safari → Settings → Extensions
   - Enable **LookieCookie**
   - Grant necessary permissions when prompted

6. Open a site with cookies, then open DevTools (⌥⌘I) and select the **LookieCookie** panel.

### Notes
- The `safari-xcode/` folder contains the native macOS app wrapper (add to `.gitignore` if desired)
- For App Store distribution, you'll need an Apple Developer Program membership ($99/year)
- Safari requires explicit user permission for cookie access per-site
