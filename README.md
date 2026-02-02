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
- `chrome/` and `firefox/` contain **manifest overrides only**.
- `dist/` is generated output for each browser build (do not edit manually).

## Development Workflow
1. Edit shared files in `shared/`:
   - `background.js`
   - `devtools.html`, `devtools.js`
   - `panel.html`, `panel.css`, `panel.js`
2. Build browser outputs:
   - `npm run build` (or `node scripts/build.mjs`)
3. Load the extension from `dist/chrome` or `dist/firefox`.

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
