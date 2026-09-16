# Agent guide

Project constraints for anyone (including coding agents) changing this repo. User docs: [README.md](README.md). Build/run: [DEVELOPMENT.md](DEVELOPMENT.md).

## Product

- Local-only **Export chat** ZIP viewer (Threadkeep). Not a messaging client. Do not brand the product with third-party trademarks.
- Do not add cloud sync, telemetry, analytics, crash reporters, or remote APIs.
- Bind the HTTP server to `127.0.0.1` only. Never `0.0.0.0`.
- The packaged app is an Electron window. Do not send users to a system browser for the main UI.
- README is for **users**. Put npm, packaging, env vars, and architecture in `DEVELOPMENT.md`.

## Privacy and git

- Never commit chat text, ZIP archives, `archive.db`, media cache, or real export folder paths (for example a user’s Documents directory).
- Never write index/config/cache next to source. Use `getDataDir()` / the OS user-data directory. Ignore `THREADKEEP_DATA_DIR` if it resolves inside the repo.
- Tests and docs use synthetic names (Alice, Bob). Do not paste personal chat contents into source, commits, or markdown.
- Do not commit `release/`, `build/`, `dist/`, `node_modules/`, or `.localdata/`.

## Code map

- Import: `server/parser.ts`, `server/importer.ts` (yauzl, lazy ZIP, `attachOrphanMedia`).
- Index: `server/db.ts` (`node:sqlite`, FTS5). Message pages are **seq ranges**, not `LIMIT/OFFSET` on unordered rows.
- Media: extract from the ZIP only when the user opens a file (`server/media.ts`).
- UI: chat-style colors (`tk-*` tokens), Indic font stack (Nirmala UI, Kalinga). Conversation list is virtualized; measure rows from `top: 0`.
- Folder pick: Electron `dialog.showOpenDialog`. Path paste is the fallback (Cursor browser / headless).

## Export behavior (do not “fix” into the ZIP)

- Missed voice/video calls are normal text in the transcript.
- *This message is not supported* = empty export line, no attachment (view-once, many stickers, polls, live location, expired disappearing messages, and similar). The bytes were never in the ZIP.
- *Media omitted from this export* = without-media export.
- Incremental import skips unchanged ZIPs. After parser changes that affect existing chats, wipe the data dir and reindex.

## Tests

- `npm test` (Vitest). API tests may set `THREADKEEP_ALLOW_PATH=1` and a temp `THREADKEEP_DATA_DIR` **outside** the repo (`os.tmpdir()`).
- Do not point tests at a real chat backup folder. Parser fixtures may use real export filenames (`WhatsApp Chat with …`) because that is the on-disk format.

## Changes

- Match existing style. Do not add unrelated refactors or extra markdown the user did not ask for.
- Do not commit unless the user asks. Do not force-push.
