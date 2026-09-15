import fs from "node:fs";
import path from "node:path";
import {
  chatNameFromFilename,
  isGroupChat,
  looksLikeChatTranscript,
  mimeFromFilename,
  parseWhatsAppChat,
  attachOrphanMedia,
  uniqueSenders,
} from "./parser.js";
import {
  deleteChatBySource,
  findArchiveByHash,
  findArchiveByPath,
  getDb,
  listArchiveIssues,
  upsertArchiveFile,
} from "./db.js";
import { hashFile, listZipEntries, readZipEntry } from "./zip.js";
import { saveConfig } from "./config.js";
import { resolveExistingPath } from "./paths.js";
import type { ImportProgress, ImportReport, ParsedMessage } from "./types.js";

const idleProgress = (): ImportProgress => ({
  phase: "idle",
  found: 0,
  current: 0,
  total: 0,
  percent: 0,
  currentFile: null,
  message: "",
  report: null,
});

let progress: ImportProgress = idleProgress();
let running = false;
const listeners = new Set<(state: ImportProgress) => void>();

export function getImportProgress(): ImportProgress {
  return progress;
}

export function subscribeImport(listener: (state: ImportProgress) => void): () => void {
  listeners.add(listener);
  listener(progress);
  return () => listeners.delete(listener);
}

function emit(patch: Partial<ImportProgress>): void {
  progress = { ...progress, ...patch };
  if (progress.total > 0) {
    progress.percent = Math.min(100, Math.round((progress.current / progress.total) * 100));
  }
  for (const listener of listeners) listener(progress);
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function discoverZipFiles(root: string): string[] {
  const results: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "cache", "__MACOSX"].includes(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) {
        results.push(full);
      }
    }
  };
  walk(root, 0);
  results.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return results;
}

function pickChatTxt(entries: string[]): string | null {
  const txts = entries.filter((name) => name.toLowerCase().endsWith(".txt"));
  const preferred = txts.filter((name) => looksLikeChatTranscript(name));
  if (preferred.length) {
    preferred.sort((a, b) => a.length - b.length);
    return preferred[0];
  }
  if (txts.length === 1) return txts[0];
  return null;
}

function resolveInternalMedia(filename: string, entries: string[]): string | null {
  const wanted = filename.replace(/\\/g, "/");
  const exact = entries.find((entry) => entry === wanted || entry.endsWith(`/${wanted}`));
  if (exact) return exact;
  const base = path.posix.basename(wanted).toLowerCase();
  const byBase = entries.filter((entry) => path.posix.basename(entry).toLowerCase() === base);
  if (byBase.length === 1) return byBase[0];
  const withoutDot = base.replace(/\.+$/, "");
  const fuzzy = entries.find((entry) => path.posix.basename(entry).toLowerCase().replace(/\.+$/, "") === withoutDot);
  return fuzzy || null;
}

function previewText(message: ParsedMessage): string {
  if (message.isDeleted) return "This message was deleted";
  if (message.attachment) {
    if (message.attachment.omitted) return "Media omitted";
    return message.text?.trim() || message.attachment.filename || message.type;
  }
  const text = message.text.replace(/\s+/g, " ").trim();
  return text.slice(0, 180);
}

function insertChat(
  zipPath: string,
  archiveId: number,
  chatName: string,
  messages: ParsedMessage[],
  entries: Array<{ fileName: string; uncompressedSize: number }>,
  ownerName: string | null,
): number {
  const database = getDb();
  const senders = uniqueSenders(messages);
  const isGroup = isGroupChat(messages, senders.length) ? 1 : 0;
  const entryNames = entries.map((entry) => entry.fileName);
  const sizeByName = new Map(entries.map((entry) => [entry.fileName, entry.uncompressedSize]));

  const counts = {
    media: 0,
    image: 0,
    video: 0,
    audio: 0,
    document: 0,
  };
  for (const message of messages) {
    if (!message.attachment) continue;
    counts.media += 1;
    if (message.type === "image" || message.type === "sticker") counts.image += 1;
    if (message.type === "video") counts.video += 1;
    if (message.type === "audio") counts.audio += 1;
    if (message.type === "document") counts.document += 1;
  }

  const lastUser = [...messages].reverse().find((message) => !message.isSystem) || messages[messages.length - 1];
  const result = database
    .prepare(
      `INSERT INTO chats (
        name, source_file_id, is_group, message_count, first_message_at, last_message_at,
        last_message_text, last_message_sender, media_count, image_count, video_count,
        audio_count, document_count, participant_count
      ) VALUES (@name, @source_file_id, @is_group, @message_count, @first_message_at, @last_message_at,
        @last_message_text, @last_message_sender, @media_count, @image_count, @video_count,
        @audio_count, @document_count, @participant_count)`,
    )
    .run({
      name: chatName,
      source_file_id: archiveId,
      is_group: isGroup,
      message_count: messages.length,
      first_message_at: messages[0] ? messages[0].timestamp.getTime() : null,
      last_message_at: lastUser ? lastUser.timestamp.getTime() : null,
      last_message_text: lastUser ? previewText(lastUser) : null,
      last_message_sender: lastUser?.sender ?? null,
      media_count: counts.media,
      image_count: counts.image,
      video_count: counts.video,
      audio_count: counts.audio,
      document_count: counts.document,
      participant_count: senders.length,
    });
  const chatId = Number(result.lastInsertRowid);

  const insertParticipant = database.prepare(
    "INSERT INTO participants (chat_id, name, message_count) VALUES (?, ?, ?)",
  );
  const senderCounts = new Map<string, number>();
  for (const message of messages) {
    if (!message.sender) continue;
    senderCounts.set(message.sender, (senderCounts.get(message.sender) || 0) + 1);
  }
  for (const [name, count] of senderCounts) {
    insertParticipant.run(chatId, name, count);
  }

  const insertMessage = database.prepare(
    `INSERT INTO messages (
      chat_id, seq, timestamp, sender, text, type, is_from_me, is_deleted, is_edited, is_system
    ) VALUES (@chat_id, @seq, @timestamp, @sender, @text, @type, @is_from_me, @is_deleted, @is_edited, @is_system)`,
  );
  const insertAttachment = database.prepare(
    `INSERT INTO attachments (
      message_id, chat_id, zip_path, internal_path, filename, mime_type, size, omitted, type
    ) VALUES (@message_id, @chat_id, @zip_path, @internal_path, @filename, @mime_type, @size, @omitted, @type)`,
  );

  const insertMany = () => {
    for (let seq = 0; seq < messages.length; seq += 1) {
      const message = messages[seq];
      const inserted = insertMessage.run({
        chat_id: chatId,
        seq,
        timestamp: message.timestamp.getTime(),
        sender: message.sender,
        text: message.text,
        type: message.type,
        is_from_me: ownerName && message.sender === ownerName ? 1 : 0,
        is_deleted: message.isDeleted ? 1 : 0,
        is_edited: message.isEdited ? 1 : 0,
        is_system: message.isSystem ? 1 : 0,
      });
      if (message.attachment) {
        const internal = message.attachment.omitted
          ? ""
          : resolveInternalMedia(message.attachment.filename, entryNames) || message.attachment.filename;
        insertAttachment.run({
          message_id: Number(inserted.lastInsertRowid),
          chat_id: chatId,
          zip_path: zipPath,
          internal_path: internal,
          filename: message.attachment.filename || path.posix.basename(internal),
          mime_type: mimeFromFilename(message.attachment.filename || internal),
          size: sizeByName.get(internal) ?? null,
          omitted: message.attachment.omitted ? 1 : 0,
          type: message.attachment.type,
        });
      }
    }
  };
  database.exec("BEGIN");
  try {
    insertMany();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  database.prepare("UPDATE archive_files SET chat_id = ?, status = 'imported', error = NULL WHERE id = ?").run(
    chatId,
    archiveId,
  );
  return chatId;
}

function detectOwner(): string | null {
  const rows = getDb()
    .prepare(
      `SELECT name, COUNT(DISTINCT chat_id) AS chats
       FROM participants
       GROUP BY name
       ORDER BY chats DESC, SUM(message_count) DESC
       LIMIT 1`,
    )
    .all() as Array<{ name: string; chats: number }>;
  if (!rows.length) return null;
  if (rows[0].chats <= 1 && rows.length === 1) return rows[0].name;
  return rows[0].name;
}

function applyOwnerFlags(ownerName: string): void {
  getDb().prepare("UPDATE messages SET is_from_me = CASE WHEN sender = ? THEN 1 ELSE 0 END").run(ownerName);
}

async function importOneZip(
  zipPath: string,
  ownerName: string | null,
  hashIfNeeded: boolean,
): Promise<{ status: string; reason?: string }> {
  const filename = path.basename(zipPath);
  const stat = fs.statSync(zipPath);
  const existing = findArchiveByPath(zipPath);

  if (
    existing &&
    existing.status === "imported" &&
    existing.size === stat.size &&
    existing.mtime === Math.trunc(stat.mtimeMs) &&
    existing.chat_id
  ) {
    return { status: "reused" };
  }

  if (existing && existing.chat_id) {
    deleteChatBySource(existing.id);
  }

  let hash: string | null = existing?.hash ?? null;
  if (hashIfNeeded) {
    try {
      hash = await hashFile(zipPath);
    } catch {
      hash = existing?.hash ?? null;
    }
  }

  if (hash) {
    const duplicate = findArchiveByHash(hash);
    if (duplicate && duplicate.path !== zipPath) {
      upsertArchiveFile({
        path: zipPath,
        filename,
        size: stat.size,
        mtime: Math.trunc(stat.mtimeMs),
        hash,
        status: "duplicate",
        error: `Duplicate of ${path.basename(duplicate.path)}`,
        duplicate_of: duplicate.id,
      });
      return { status: "duplicate", reason: `Duplicate of ${path.basename(duplicate.path)}` };
    }
  }

  const archiveId = upsertArchiveFile({
    path: zipPath,
    filename,
    size: stat.size,
    mtime: Math.trunc(stat.mtimeMs),
    hash,
    status: "pending",
  });

  let entries;
  try {
    entries = await listZipEntries(zipPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not read ZIP";
    upsertArchiveFile({
      path: zipPath,
      filename,
      size: stat.size,
      mtime: Math.trunc(stat.mtimeMs),
      hash,
      status: "error",
      error: reason,
    });
    return { status: "error", reason };
  }

  if (!entries.length) {
    upsertArchiveFile({
      path: zipPath,
      filename,
      size: stat.size,
      mtime: Math.trunc(stat.mtimeMs),
      hash,
      status: "skipped",
      error: "The ZIP file is empty",
    });
    return { status: "skipped", reason: "The ZIP file is empty" };
  }

  const chatTxt = pickChatTxt(entries.map((entry) => entry.fileName));
  if (!chatTxt) {
    upsertArchiveFile({
      path: zipPath,
      filename,
      size: stat.size,
      mtime: Math.trunc(stat.mtimeMs),
      hash,
      status: "skipped",
      error: "The exported chat format could not be recognized",
    });
    return { status: "skipped", reason: "The exported chat format could not be recognized" };
  }

  let raw: Buffer;
  try {
    raw = await readZipEntry(zipPath, chatTxt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not read chat transcript";
    upsertArchiveFile({
      path: zipPath,
      filename,
      size: stat.size,
      mtime: Math.trunc(stat.mtimeMs),
      hash,
      status: "error",
      error: reason,
    });
    return { status: "error", reason };
  }

  let source = "";
  for (const encoding of ["utf8", "utf16le"] as const) {
    try {
      source = raw.toString(encoding);
      if (source.replace(/\0/g, "").trim()) break;
    } catch {
      continue;
    }
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  const parsed = parseWhatsAppChat(source);
  if (!parsed.messages.length) {
    upsertArchiveFile({
      path: zipPath,
      filename,
      size: stat.size,
      mtime: Math.trunc(stat.mtimeMs),
      hash,
      status: "skipped",
      error: "No messages could be parsed from the export",
    });
    return { status: "skipped", reason: "No messages could be parsed from the export" };
  }

  const chatName = chatNameFromFilename(chatTxt) || chatNameFromFilename(filename);
  attachOrphanMedia(
    parsed.messages,
    entries.map((entry) => entry.fileName),
  );
  const lastUser = [...parsed.messages].reverse().find((message) => !message.isSystem) || parsed.messages[parsed.messages.length - 1];
  const duplicateChat = getDb()
    .prepare(
      `SELECT a.filename, a.id as archive_id
       FROM chats c
       JOIN archive_files a ON a.id = c.source_file_id
       WHERE c.name = ? AND c.message_count = ? AND c.first_message_at = ? AND c.last_message_at = ?
       LIMIT 1`,
    )
    .get(
      chatName,
      parsed.messages.length,
      parsed.messages[0].timestamp.getTime(),
      lastUser.timestamp.getTime(),
    ) as { filename: string; archive_id: number } | undefined;
  if (duplicateChat) {
    upsertArchiveFile({
      path: zipPath,
      filename,
      size: stat.size,
      mtime: Math.trunc(stat.mtimeMs),
      hash,
      status: "duplicate",
      error: `Duplicate of ${duplicateChat.filename}`,
      duplicate_of: duplicateChat.archive_id,
    });
    return { status: "duplicate", reason: `Duplicate of ${duplicateChat.filename}` };
  }
  try {
    insertChat(zipPath, archiveId, chatName, parsed.messages, entries, ownerName);
    return { status: "imported" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to index chat";
    upsertArchiveFile({
      path: zipPath,
      filename,
      size: stat.size,
      mtime: Math.trunc(stat.mtimeMs),
      hash,
      status: "error",
      error: reason,
    });
    return { status: "error", reason };
  }
}

export async function importArchive(archivePath: string): Promise<ImportReport> {
  if (running) return progress.report || emptyReport();
  running = true;
  emit({
    phase: "scan",
    found: 0,
    current: 0,
    total: 0,
    percent: 0,
    currentFile: null,
    message: "Looking for chat exports…",
    report: null,
  });

  const report: ImportReport = {
    found: 0,
    imported: 0,
    skipped: 0,
    duplicates: 0,
    errors: 0,
    reused: 0,
    skippedFiles: [],
  };

  try {
    const root = resolveExistingPath(archivePath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error("Archive folder could not be found");
    }

    const zips = discoverZipFiles(root);
    report.found = zips.length;
    emit({
      phase: "index",
      found: zips.length,
      total: Math.max(zips.length, 1),
      current: 0,
      message: zips.length ? `Found ${zips.length} chat export${zips.length === 1 ? "" : "s"}` : "No ZIP files found",
    });

    const ownerGuess = detectOwner();
    const sizeCounts = new Map<number, number>();
    for (const zipPath of zips) {
      try {
        const size = fs.statSync(zipPath).size;
        sizeCounts.set(size, (sizeCounts.get(size) || 0) + 1);
      } catch {
        // skip unreadable files; importOneZip will record the error
      }
    }

    for (let index = 0; index < zips.length; index += 1) {
      const zipPath = zips[index];
      emit({
        current: index,
        currentFile: path.basename(zipPath),
        message: `Indexing… ${index} / ${zips.length}`,
      });
      try {
        let size = 0;
        try {
          size = fs.statSync(zipPath).size;
        } catch {
          size = 0;
        }
        const result = await importOneZip(zipPath, ownerGuess, (sizeCounts.get(size) || 0) > 1);
        if (result.status === "imported") report.imported += 1;
        else if (result.status === "reused") report.reused += 1;
        else if (result.status === "duplicate") {
          report.duplicates += 1;
          report.skippedFiles.push({ filename: path.basename(zipPath), reason: result.reason || "Duplicate archive" });
        } else if (result.status === "skipped") {
          report.skipped += 1;
          report.skippedFiles.push({ filename: path.basename(zipPath), reason: result.reason || "Skipped" });
        } else {
          report.errors += 1;
          report.skippedFiles.push({ filename: path.basename(zipPath), reason: result.reason || "Could not import" });
        }
      } catch (error) {
        report.errors += 1;
        report.skippedFiles.push({
          filename: path.basename(zipPath),
          reason: error instanceof Error ? error.message : "Could not import",
        });
      }
      emit({ current: index + 1, percent: Math.round(((index + 1) / zips.length) * 100) });
      await yieldEventLoop();
    }

    const ownerName = detectOwner();
    if (ownerName) applyOwnerFlags(ownerName);

    const issues = listArchiveIssues();
    if (!report.skippedFiles.length && issues.length) {
      report.skippedFiles = issues.map((issue) => ({ filename: issue.filename, reason: issue.reason }));
    }

    saveConfig({
      archivePath: root,
      lastIndexed: new Date().toISOString(),
      ownerName,
    });

    emit({
      phase: "complete",
      current: zips.length,
      total: zips.length,
      percent: 100,
      currentFile: null,
      message: zips.length ? "Import complete" : "No chat exports were found in that folder",
      report,
    });
    return report;
  } catch (error) {
    emit({
      phase: "error",
      message: error instanceof Error ? error.message : "Import failed",
      report,
    });
    throw error;
  } finally {
    running = false;
  }
}

function emptyReport(): ImportReport {
  return { found: 0, imported: 0, skipped: 0, duplicates: 0, errors: 0, reused: 0, skippedFiles: [] };
}

export function isImportRunning(): boolean {
  return running;
}
