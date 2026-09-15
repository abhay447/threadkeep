# WhatsApp Archive Viewer

A private, local desktop app for reading WhatsApp chats you exported from Android. It runs only on your computer. Nothing is uploaded.

It is not WhatsApp, and it cannot send messages or copy chats onto an iPhone. It is a **failsafe reader** for ZIP files you exported yourself.

## Why this exists

Apple’s **Move to iOS** app on Android is supposed to migrate WhatsApp data to an iPhone. That transfer often fails, finishes only in part, or leaves important threads missing.

If the automatic move does not work, you can still keep those chats:

1. On Android, **manually export** the chats that matter (WhatsApp → a chat → **More** → **Export chat**).
2. Copy the ZIP files to a Windows, Linux, or Mac computer (USB drive, cable, cloud folder you control, or a shared disk).
3. Open this app and point it at that folder.

You then have a searchable, WhatsApp-like view of those messages, including photos, videos, voice notes, and documents that were included in the export. Use it to recover dates, media, and wording you would otherwise lose.

Export **before** you wipe the Android phone or rely on Move to iOS.

## What you need

A folder of WhatsApp **Export chat** ZIP files, usually from Android. iOS-style exports (a `_chat.txt` inside a ZIP) also work when they use the same idea.

Each ZIP is typically one chat and contains:

- a `.txt` transcript (`WhatsApp Chat with …txt`)
- optional media: `IMG-…`, `VID-…`, `PTT-…` / `AUD-…`, PDFs, and similar files

You can put many ZIPs in one folder. Subfolders are scanned too.

### Export from Android (one chat)

1. Open WhatsApp and the chat.
2. Tap the chat name, or **⋮** / **More**.
3. Choose **Export chat**.
4. Choose **With media** if you need photos, video, and voice notes. **Without media** is smaller and still keeps the text.
5. Save the ZIP (Drive, Files, email to yourself, USB, etc.).
6. Repeat for every chat you cannot afford to lose.

WhatsApp does not offer a single “export everything” button. Critical chats have to be exported one by one. A full device backup is not the same format; this app reads **Export chat** ZIPs, not the encrypted `msgstore.db` backup.

## Run the app

Use a packaged app from a [GitHub Release](https://github.com/abhay447/whatsapp-archive-viewer/releases) when one is available, or from a `release/` folder someone built for you.

- **Windows:** unzip `whatsapp-archive-viewer-win-x64.zip` into its own folder, then double-click **WhatsApp Archive Viewer.exe**. Leave the other unzipped files next to the `.exe`.
- **Linux:** `chmod +x` the `.AppImage` and run it, or extract `whatsapp-archive-viewer-linux-x64.tar.gz` and run **WhatsApp Archive Viewer**.
- **Mac (Apple Silicon):** unzip `whatsapp-archive-viewer-mac-arm64.zip` and open **WhatsApp Archive Viewer**. If macOS says it cannot verify the developer, Control-click the app, choose **Open**, then **Open** again. This build is for M1/M2/M3/M4 Macs, not Intel Macs.

A desktop window opens. It does not use your web browser.

If you cloned this repository instead of downloading a packaged app:

1. Install [Node.js 22 or newer](https://nodejs.org).
2. Double-click `start.bat` on Windows, or run `./start.sh` on Linux/macOS.
3. The first launch installs what it needs and may take a minute. A desktop window opens.

### Open your export folder

1. Click **Select WhatsApp Archive Folder**.
2. Choose the folder that contains the ZIP files (not a single ZIP; the folder around them).
3. If a system folder window does not appear, paste the full path and click **Open this folder**.
4. Wait while chats are indexed. Large archives with media can take a few minutes the first time.

The folder is remembered. Next time, start the app again. New or changed ZIPs are picked up automatically.

## What you can do

- Browse chats in a WhatsApp-style list and conversation view
- Search across all chats or inside one chat (Ctrl+K / ⌘K)
- Filter by sender, date, and media
- Open images, play audio/video, and save files
- Switch light, dark, or system appearance in Settings

Your own messages are aligned on the right when the export includes your WhatsApp display name.

## What the export cannot include

The Android export is incomplete by design. This app can only show what WhatsApp put in the ZIP.

| In the export | In this app |
| --- | --- |
| Text, including many Indic scripts | Shown in the thread |
| Photos, video, voice notes, documents in the ZIP | Shown or playable; opened from the ZIP only when you view them |
| **Media omitted** (export without media) | Label: *Media omitted from this export* |
| **Missed voice/video call** | Ordinary text, as WhatsApp wrote it |
| Blank lines with no file (view-once media, many stickers, polls, live location, expired disappearing messages, and similar) | Label: *This message is not supported* — the payload was never in the ZIP |
| Duplicate ZIP of the same chat | One copy is kept; the other is skipped |

This app does **not** log into WhatsApp, restore chats onto an iPhone, merge into a new Android install, or decrypt Google Drive / iCloud backups.

## Privacy

- Processing is local. Chat text and media are not sent to a server.
- The app only talks to itself on this computer (`localhost`).
- After it is installed, it does not need the internet.
- Search index, settings, and a cache of files you actually opened stay on this machine. They are **not** stored inside your ZIP folder and **not** next to the app files.

Where that index lives:

- Windows: `%APPDATA%\WhatsAppArchiveViewer`
- macOS: `~/Library/Application Support/WhatsAppArchiveViewer`
- Linux: `~/.config/whatsapp-archive-viewer`

Keep the original ZIP folder. The index points at those files; deleting the ZIPs breaks photos and other media.

## If something goes wrong

- **Folder not found:** the export folder was moved or renamed. Choose it again from Settings.
- **A chat was skipped:** open the import report and read the reason. Other chats still import.
- **Port already in use:** another copy of the app is still running. Close it and start again.
- **Windows `.exe` does nothing if copied alone:** unzip the whole zip into one folder and run it from there.
- **Mac says the app cannot be opened:** Control-click **WhatsApp Archive Viewer**, choose **Open**, then **Open** again. This release is Apple Silicon only.
- **“Node.js is not installed”:** install it from https://nodejs.org and run `start.bat` or `start.sh` again.
