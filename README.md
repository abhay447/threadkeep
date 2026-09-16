# Threadkeep

A private desktop app for reading chat exports you saved as ZIP files. It runs only on this computer. Nothing is uploaded.

Threadkeep is **not affiliated with, endorsed by, or sponsored by WhatsApp or Meta**. It cannot send messages or copy chats onto an iPhone. It is a **failsafe reader** for ZIP files you exported yourself.

## Why this exists

Apple’s **Move to iOS** app on Android is supposed to migrate messaging data to an iPhone. That transfer often fails, finishes only in part, or leaves important threads missing.

If the automatic move does not work, you can still keep those chats:

1. On Android, **manually export** the chats that matter (open a chat → **More** → **Export chat**).
2. Copy the ZIP files to a Windows, Linux, or Apple Silicon Mac computer (USB drive, cable, cloud folder you control, or a shared disk).
3. Open Threadkeep and point it at that folder.

You then have a searchable list and conversation view of those messages, including photos, videos, voice notes, and documents that were included in the export. Use it to recover dates, media, and wording you would otherwise lose.

Export **before** you wipe the Android phone or rely on Move to iOS.

## Download

Get the latest apps from **[GitHub Releases](https://github.com/abhay447/threadkeep/releases/latest)**.

| Computer | File |
| --- | --- |
| Windows (64-bit) | `threadkeep-win-x64.zip` |
| Linux (64-bit) | `threadkeep-linux-x86_64.AppImage` or `threadkeep-linux-x64.tar.gz` |
| Mac with Apple Silicon (M1, M2, M3, M4) | `threadkeep-mac-arm64.zip` |

Not included: Intel Macs, 32-bit PCs, phones.

### Windows

1. Download `threadkeep-win-x64.zip`.
2. Unzip it into its own folder.
3. Double-click **Threadkeep.exe**. Leave the other unzipped files next to the `.exe`.

### Linux

- **AppImage:** `chmod +x threadkeep-linux-x86_64.AppImage`, then run it.
- **tar.gz:** extract `threadkeep-linux-x64.tar.gz` and run **Threadkeep**.

### Mac (Apple Silicon)

1. Download `threadkeep-mac-arm64.zip`.
2. Unzip it and open **Threadkeep**.
3. If macOS says it cannot verify the developer, Control-click the app, choose **Open**, then **Open** again. The app is unsigned, so this warning is expected the first time.

A desktop window opens. It does not use your web browser.

## Export from Android (one chat)

1. Open the chat in the messaging app.
2. Tap the chat name, or **⋮** / **More**.
3. Choose **Export chat**.
4. Choose **With media** if you need photos, video, and voice notes. **Without media** is smaller and still keeps the text.
5. Save the ZIP (Files, Drive, email to yourself, USB, etc.).
6. Repeat for every chat you cannot afford to lose.

Put many ZIPs in one folder. Subfolders are scanned too.

There is no single “export everything” button. A full device backup is not the same format; Threadkeep reads **Export chat** ZIPs, not encrypted database backups. iOS-style exports (a `_chat.txt` inside a ZIP) also work when they use the same idea.

Each ZIP is typically one chat and contains a `.txt` transcript (often named like `WhatsApp Chat with …txt`) plus optional media (`IMG-…`, `VID-…`, `PTT-…` / `AUD-…`, PDFs, and similar files).

## Open your export folder

1. Click **Select export folder**.
2. Choose the folder that contains the ZIP files (not a single ZIP; the folder around them).
3. If a system folder window does not appear, paste the full path and click **Open this folder**.
4. Wait while chats are indexed. Large archives with media can take a few minutes the first time.

The folder is remembered. Next time, start the app again. New or changed ZIPs are picked up automatically.

## What you can do

- Browse chats in a list and conversation view
- Search across all chats or inside one chat (Ctrl+K / ⌘K)
- Filter by sender, date, and media
- Open images, play audio/video, and save files
- Switch light, dark, or system appearance in Settings

Your own messages are aligned on the right when the export includes your display name.

## What the export cannot include

The Android export is incomplete by design. Threadkeep can only show what was put in the ZIP.

| In the export | In this app |
| --- | --- |
| Text, including many Indic scripts | Shown in the thread |
| Photos, video, voice notes, documents in the ZIP | Shown or playable; opened from the ZIP only when you view them |
| **Media omitted** (export without media) | Label: *Media omitted from this export* |
| **Missed voice/video call** | Ordinary text, as written in the export |
| Blank lines with no file (view-once media, many stickers, polls, live location, expired disappearing messages, and similar) | Label: *This message is not supported* — the payload was never in the ZIP |
| Duplicate ZIP of the same chat | One copy is kept; the other is skipped |

Threadkeep does **not** log into a messaging account, restore chats onto an iPhone, merge into a new Android install, or decrypt Google Drive / iCloud backups.

## Privacy

- Processing is local. Chat text and media are not sent to a server.
- The app only talks to itself on this computer (`localhost`).
- After you download it, it does not need the internet.
- Search index, settings, and a cache of files you actually opened stay on this machine. They are **not** stored inside your ZIP folder and **not** next to the app files.

Where that index lives:

- Windows: `%APPDATA%\Threadkeep`
- macOS: `~/Library/Application Support/Threadkeep`
- Linux: `~/.config/threadkeep`

Keep the original ZIP folder. The index points at those files; deleting the ZIPs breaks photos and other media.

## If something goes wrong

- **Folder not found:** the export folder was moved or renamed. Choose it again from Settings.
- **A chat was skipped:** open the import report and read the reason. Other chats still import.
- **Port already in use:** another copy of the app is still running. Close it and start again.
- **Windows `.exe` does nothing if copied alone:** unzip the whole zip into one folder and run it from there.
- **Mac says the app cannot be opened:** Control-click **Threadkeep**, choose **Open**, then **Open** again. The published Mac build is Apple Silicon only.
- **Wrong Mac download:** Intel Macs are not supported. Use a Windows or Linux computer, or run from source on that Mac (see [DEVELOPMENT.md](DEVELOPMENT.md)).

## Names

Threadkeep is an independent, unofficial tool. WhatsApp is a trademark of WhatsApp LLC. Those names appear in this README only to describe the origin of the files Threadkeep can read.
