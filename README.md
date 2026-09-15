# WhatsApp Archive Viewer

Browse your exported WhatsApp chats privately on this computer. Nothing is uploaded.

## How to use

1. Install [Node.js](https://nodejs.org) (version 22 or newer) if it is not already installed.
2. Double-click `start.bat` on Windows, or run `./start.sh` on Mac/Linux.
3. The first time, wait while it installs. A browser window will open.
4. Click **Select WhatsApp Archive Folder**.
5. Choose the folder that contains your WhatsApp ZIP files, for example `whatsapp_manual_export_folder`.
6. Wait while chats are indexed. After that, you can search and read them like a chat app.

Your folder choice is remembered. Next time, just start the app again.

Open this address if the browser does not open by itself:

```text
http://127.0.0.1:4783
```

## What you need

A folder of WhatsApp **Export chat** ZIP files from Android (or similar `.zip` exports). Each ZIP usually contains a `.txt` chat file and optional photos, videos, or voice notes.

## Privacy

Your archive is processed locally on this computer. No chat data is uploaded or sent to the internet. The app only listens on `localhost` and does not need an internet connection after it has been installed.

## If something goes wrong

- **Folder not found:** the archive folder was moved or renamed. Choose it again from Settings.
- **A chat was skipped:** open the import report and read the reason. Other chats still import.
- **Node.js is missing:** install it from https://nodejs.org and start the app again.

## Settings

In the app, open Settings to see the current archive folder, change it, or switch light/dark mode.

## For developers

```bash
npm install
npm test
npm start
```

Use `npm run dev` for a live-reloading frontend. Application data is stored in:

- Windows: `%APPDATA%\WhatsAppArchiveViewer`
- macOS: `~/Library/Application Support/WhatsAppArchiveViewer`
- Linux: `~/.config/whatsapp-archive-viewer`
