# Development

How to run, test, and package WhatsApp Archive Viewer from source. User instructions live in [README.md](README.md). Agent constraints live in [AGENTS.md](AGENTS.md).

## Requirements

- [Node.js](https://nodejs.org) 22 or newer (`node:sqlite` / FTS5)
- npm (comes with Node)

## Commands

```bash
npm install
npm test
npm start
```

| Command | What it does |
| --- | --- |
| `npm start` | Builds the UI if needed, bundles Electron, opens the desktop window |
| `npm run start:server` | Local API + UI at `http://127.0.0.1:4783` in a browser |
| `npm run dev` | Live-reloading frontend with the local API |
| `npm test` | Vitest |
| `npm run build:binaries` | Windows zip + Linux AppImage and tar.gz in `release/` |

`start.bat` / `start.sh` call `npm start` after installing dependencies once.

## Layout

- `src/` — React UI (Vite, Tailwind, `@tanstack/react-virtual`)
- `server/` — Express on `127.0.0.1:4783`, SQLite index, ZIP import, media extract
- `electron/main.ts` — desktop window, native folder dialog, starts the server
- `scripts/start-desktop.mjs` — dev/desktop launch
- `scripts/package-binaries.mjs` — `vite` + `esbuild` + `electron-builder`
- `tests/` — synthetic ZIP fixtures (Alice/Bob), no real chats

The UI talks only to the local API. Electron loads `http://127.0.0.1:4783` and does not open the system browser (`WA_NO_OPEN=1`).

## Data directory

Index, `config.json`, and `cache/media` go to the OS user-data folder, never next to the source or packaged binaries:

- Windows: `%APPDATA%\WhatsAppArchiveViewer`
- macOS: `~/Library/Application Support/WhatsAppArchiveViewer`
- Linux: `~/.config/whatsapp-archive-viewer`

`WA_ARCHIVE_DATA_DIR` may point somewhere else **outside** the repo. A path inside the project (including `.localdata`) is ignored.

Gitignored: `node_modules/`, `dist/`, `build/`, `release/`, `.localdata/`.

## Environment

| Variable | Purpose |
| --- | --- |
| `WA_ARCHIVE_DATA_DIR` | Override index location (must be outside the repo) |
| `WA_NO_OPEN` | Do not open a system browser |
| `WA_SKIP_BUILD` | Skip building the frontend on server start |
| `WA_FRONTEND_DIR` | Directory that contains `index.html` |
| `WA_PACKAGED` | Set by packaged Electron |
| `WA_ALLOW_PATH` | Tests only: allow posting a folder path without the native picker |
| `WA_TEST_SERVER` | Tests only: start without binding extra listeners |
| `PORT` | Default `4783` |

## Packaging

```bash
npm install
npm run build:binaries
```

Writes `release/whatsapp-archive-viewer-win-x64.zip`, Linux AppImage, and `tar.gz`. Those artifacts are not committed.

Windows: keep the unzipped `.exe` next to its DLLs. Linux: `chmod +x` the AppImage.

Cross-building Windows from Linux depends on electron-builder’s wine/nsis setup on the machine.

## Import notes

- Incremental import skips unchanged ZIPs (content hash). Parser changes that should re-parse existing chats need a wipe of the data dir, then a reindex.
- Duplicate ZIPs of the same chat: one is kept, the other is skipped.
- Blank export lines with a file in the ZIP are linked as orphan media. Remaining blanks are unsupported types WhatsApp omitted from the export, not missed calls.
