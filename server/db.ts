import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "./config.js";
import { ensureDir } from "./paths.js";
import type { AttachmentRow, ChatSummary, MessageRow, MessageType, SearchHit } from "./types.js";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  ensureDir(path.dirname(dbPath()));
  db = new DatabaseSync(dbPath());
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  migrate(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function withTransaction<T>(fn: () => T): T {
  const database = getDb();
  database.exec("BEGIN");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function resetDatabase(): void {
  closeDb();
  const file = dbPath();
  for (const suffix of ["", "-wal", "-shm"]) {
    const candidate = `${file}${suffix}`;
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
  }
}

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS archive_files (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      hash TEXT,
      status TEXT NOT NULL,
      error TEXT,
      duplicate_of INTEGER,
      chat_id INTEGER,
      last_indexed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      source_file_id INTEGER,
      is_group INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      first_message_at INTEGER,
      last_message_at INTEGER,
      last_message_text TEXT,
      last_message_sender TEXT,
      media_count INTEGER DEFAULT 0,
      image_count INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      audio_count INTEGER DEFAULT 0,
      document_count INTEGER DEFAULT 0,
      participant_count INTEGER DEFAULT 0,
      FOREIGN KEY (source_file_id) REFERENCES archive_files(id)
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      UNIQUE(chat_id, name),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      sender TEXT,
      text TEXT NOT NULL,
      type TEXT NOT NULL,
      is_from_me INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      is_edited INTEGER DEFAULT 0,
      is_system INTEGER DEFAULT 0,
      UNIQUE(chat_id, seq),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY,
      message_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      zip_path TEXT NOT NULL,
      internal_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      omitted INTEGER DEFAULT 0,
      type TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_seq ON messages(chat_id, seq);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_chats_last ON chats(last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_archive_hash ON archive_files(hash);
    CREATE INDEX IF NOT EXISTS idx_archive_status ON archive_files(status);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text,
      sender,
      chat_id UNINDEXED,
      content='messages',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  database.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text, sender, chat_id)
      VALUES (new.id, new.text, coalesce(new.sender, ''), new.chat_id);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text, sender, chat_id)
      VALUES ('delete', old.id, old.text, coalesce(old.sender, ''), old.chat_id);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text, sender, chat_id)
      VALUES ('delete', old.id, old.text, coalesce(old.sender, ''), old.chat_id);
      INSERT INTO messages_fts(rowid, text, sender, chat_id)
      VALUES (new.id, new.text, coalesce(new.sender, ''), new.chat_id);
    END;
  `);
}

export function deleteChatBySource(sourceFileId: number): void {
  const database = getDb();
  const chat = database.prepare("SELECT id FROM chats WHERE source_file_id = ?").get(sourceFileId) as
    | { id: number }
    | undefined;
  if (!chat) return;
  database.prepare("DELETE FROM attachments WHERE chat_id = ?").run(chat.id);
  database.prepare("DELETE FROM messages WHERE chat_id = ?").run(chat.id);
  database.prepare("DELETE FROM participants WHERE chat_id = ?").run(chat.id);
  database.prepare("DELETE FROM chats WHERE id = ?").run(chat.id);
}

export function findArchiveByPath(filePath: string): ArchiveFileRow | undefined {
  return getDb().prepare("SELECT * FROM archive_files WHERE path = ?").get(filePath) as ArchiveFileRow | undefined;
}

export function findArchiveByHash(hash: string): ArchiveFileRow | undefined {
  return getDb()
    .prepare("SELECT * FROM archive_files WHERE hash = ? AND status = 'imported' LIMIT 1")
    .get(hash) as ArchiveFileRow | undefined;
}

export interface ArchiveFileRow {
  id: number;
  path: string;
  filename: string;
  size: number;
  mtime: number;
  hash: string | null;
  status: string;
  error: string | null;
  duplicate_of: number | null;
  chat_id: number | null;
  last_indexed_at: number | null;
}

export function upsertArchiveFile(row: {
  path: string;
  filename: string;
  size: number;
  mtime: number;
  hash?: string | null;
  status: string;
  error?: string | null;
  duplicate_of?: number | null;
  chat_id?: number | null;
}): number {
  const database = getDb();
  const existing = findArchiveByPath(row.path);
  if (existing) {
    database
      .prepare(
        `UPDATE archive_files
         SET filename=@filename, size=@size, mtime=@mtime, hash=@hash, status=@status,
             error=@error, duplicate_of=@duplicate_of, chat_id=@chat_id, last_indexed_at=@last_indexed_at
         WHERE id=@id`,
      )
      .run({
        id: existing.id,
        filename: row.filename,
        size: row.size,
        mtime: row.mtime,
        hash: row.hash ?? existing.hash,
        status: row.status,
        error: row.error ?? null,
        duplicate_of: row.duplicate_of ?? null,
        chat_id: row.chat_id ?? null,
        last_indexed_at: Date.now(),
      });
    return existing.id;
  }
  const result = database
    .prepare(
      `INSERT INTO archive_files (path, filename, size, mtime, hash, status, error, duplicate_of, chat_id, last_indexed_at)
       VALUES (@path, @filename, @size, @mtime, @hash, @status, @error, @duplicate_of, @chat_id, @last_indexed_at)`,
    )
    .run({
      path: row.path,
      filename: row.filename,
      size: row.size,
      mtime: row.mtime,
      hash: row.hash ?? null,
      status: row.status,
      error: row.error ?? null,
      duplicate_of: row.duplicate_of ?? null,
      chat_id: row.chat_id ?? null,
      last_indexed_at: Date.now(),
    });
  return Number(result.lastInsertRowid);
}

export function listChats(query?: string): ChatSummary[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT c.*, GROUP_CONCAT(p.name, '|||') AS participant_names
       FROM chats c
       LEFT JOIN participants p ON p.chat_id = c.id
       WHERE c.message_count > 0
       GROUP BY c.id
       ORDER BY c.last_message_at DESC, c.name COLLATE NOCASE ASC`,
    )
    .all() as Array<Record<string, unknown>>;

  const mapped = rows.map(mapChatRow);
  if (!query?.trim()) return mapped;
  const needle = query.trim().toLowerCase();
  return mapped.filter(
    (chat) =>
      chat.name.toLowerCase().includes(needle) ||
      chat.participants.some((name) => name.toLowerCase().includes(needle)),
  );
}

function mapChatRow(row: Record<string, unknown>): ChatSummary {
  const names = String(row.participant_names || "")
    .split("|||")
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    id: Number(row.id),
    name: String(row.name),
    isGroup: Boolean(row.is_group),
    messageCount: Number(row.message_count),
    firstMessageAt: row.first_message_at == null ? null : Number(row.first_message_at),
    lastMessageAt: row.last_message_at == null ? null : Number(row.last_message_at),
    lastMessageText: (row.last_message_text as string | null) ?? null,
    lastMessageSender: (row.last_message_sender as string | null) ?? null,
    mediaCount: Number(row.media_count || 0),
    imageCount: Number(row.image_count || 0),
    videoCount: Number(row.video_count || 0),
    audioCount: Number(row.audio_count || 0),
    documentCount: Number(row.document_count || 0),
    participantCount: Number(row.participant_count || names.length),
    participants: names,
  };
}

export function getChat(id: number): ChatSummary | null {
  const row = getDb()
    .prepare(
      `SELECT c.*, GROUP_CONCAT(p.name, '|||') AS participant_names
       FROM chats c
       LEFT JOIN participants p ON p.chat_id = c.id
       WHERE c.id = ?
       GROUP BY c.id`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapChatRow(row) : null;
}

function mapMessage(row: Record<string, unknown>, previousTimestamp: number | null): MessageRow {
  const timestamp = Number(row.timestamp);
  const attachmentId = row.attachment_id == null ? null : Number(row.attachment_id);
  return {
    id: Number(row.id),
    chatId: Number(row.chat_id),
    seq: Number(row.seq),
    timestamp,
    sender: (row.sender as string | null) ?? null,
    text: String(row.text || ""),
    type: row.type as MessageType,
    isFromMe: Boolean(row.is_from_me),
    isDeleted: Boolean(row.is_deleted),
    isEdited: Boolean(row.is_edited),
    isSystem: Boolean(row.is_system),
    isFirstOfDay: previousTimestamp === null || !sameDay(previousTimestamp, timestamp),
    attachment: attachmentId
      ? {
          id: attachmentId,
          filename: String(row.att_filename || ""),
          mimeType: (row.att_mime as string | null) ?? null,
          size: row.att_size == null ? null : Number(row.att_size),
          omitted: Boolean(row.att_omitted),
          type: (row.att_type as MessageType) || (row.type as MessageType),
        }
      : null,
  };
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

const MESSAGE_SELECT = `
  SELECT m.*,
         a.id AS attachment_id,
         a.filename AS att_filename,
         a.mime_type AS att_mime,
         a.size AS att_size,
         a.omitted AS att_omitted,
         a.type AS att_type
  FROM messages m
  LEFT JOIN attachments a ON a.message_id = m.id
`;

export function getMessages(chatId: number, offset: number, limit: number): MessageRow[] {
  const rows = getDb()
    .prepare(
      `${MESSAGE_SELECT}
       WHERE m.chat_id = ?
       ORDER BY m.seq ASC
       LIMIT ? OFFSET ?`,
    )
    .all(chatId, limit, offset) as Array<Record<string, unknown>>;

  let previous: number | null = null;
  if (offset > 0 && rows.length) {
    const prev = getDb()
      .prepare("SELECT timestamp FROM messages WHERE chat_id = ? AND seq = ?")
      .get(chatId, offset - 1) as { timestamp: number } | undefined;
    previous = prev ? prev.timestamp : null;
  }
  return rows.map((row) => {
    const mapped = mapMessage(row, previous);
    previous = mapped.timestamp;
    return mapped;
  });
}

export function getMessageIndex(chatId: number, messageId: number): number | null {
  const row = getDb()
    .prepare("SELECT seq FROM messages WHERE chat_id = ? AND id = ?")
    .get(chatId, messageId) as { seq: number } | undefined;
  return row ? row.seq : null;
}

export function getAttachment(id: number): {
  id: number;
  zip_path: string;
  internal_path: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
  omitted: number;
  type: string;
} | null {
  return (
    (getDb().prepare("SELECT * FROM attachments WHERE id = ?").get(id) as {
      id: number;
      zip_path: string;
      internal_path: string;
      filename: string;
      mime_type: string | null;
      size: number | null;
      omitted: number;
      type: string;
    } | undefined) ?? null
  );
}

export interface SearchFilters {
  q: string;
  chatId?: number;
  sender?: string;
  after?: number;
  before?: number;
  hasMedia?: boolean;
  mediaType?: string;
  limit?: number;
}

function escapeFts(query: string): string {
  const cleaned = query.replace(/["']/g, " ").trim();
  if (!cleaned) return "";
  const terms = cleaned.split(/\s+/).filter(Boolean);
  return terms.map((term) => `"${term.replace(/"/g, "")}"*`).join(" AND ");
}

export function searchMessages(filters: SearchFilters): SearchHit[] {
  const database = getDb();
  const limit = Math.min(filters.limit ?? 80, 200);
  const clauses: string[] = [];
  const params: Record<string, unknown> = { limit };

  const fts = escapeFts(filters.q);
  const useFts = Boolean(fts) && !isMostlyEmoji(filters.q);
  const hasFilters = Boolean(filters.chatId || filters.sender || filters.after || filters.before || filters.hasMedia || filters.mediaType);

  if (useFts) {
    clauses.push("messages_fts MATCH @match");
    params.match = fts;
  } else if (filters.q.trim()) {
    clauses.push("(m.text LIKE @like OR m.sender LIKE @like)");
    params.like = `%${filters.q.trim()}%`;
  } else if (!hasFilters) {
    return [];
  }

  if (filters.chatId) {
    clauses.push("m.chat_id = @chatId");
    params.chatId = filters.chatId;
  }
  if (filters.sender) {
    clauses.push("m.sender = @sender");
    params.sender = filters.sender;
  }
  if (filters.after) {
    clauses.push("m.timestamp >= @after");
    params.after = filters.after;
  }
  if (filters.before) {
    clauses.push("m.timestamp <= @before");
    params.before = filters.before;
  }
  if (filters.hasMedia) {
    clauses.push("m.type NOT IN ('text', 'system')");
  }
  if (filters.mediaType) {
    clauses.push("m.type = @mediaType");
    params.mediaType = filters.mediaType;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = useFts
    ? `SELECT m.id, m.chat_id, m.seq, m.timestamp, m.sender, m.text, m.type, c.name AS chat_name,
              snippet(messages_fts, 0, '<<', '>>', '…', 16) AS snippet
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       JOIN chats c ON c.id = m.chat_id
       ${where}
       ORDER BY m.timestamp DESC
       LIMIT @limit`
    : `SELECT m.id, m.chat_id, m.seq, m.timestamp, m.sender, m.text, m.type, c.name AS chat_name,
              m.text AS snippet
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       ${where}
       ORDER BY m.timestamp DESC
       LIMIT @limit`;

  const rows = database.prepare(sql).all(params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    messageId: Number(row.id),
    chatId: Number(row.chat_id),
    chatName: String(row.chat_name),
    seq: Number(row.seq),
    timestamp: Number(row.timestamp),
    sender: (row.sender as string | null) ?? null,
    snippet: highlightSnippet(String(row.snippet || row.text || ""), filters.q),
    type: row.type as MessageType,
  }));
}

function isMostlyEmoji(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  return /[^\p{L}\p{N}\s]/u.test(trimmed) && !/[A-Za-z0-9]/.test(trimmed);
}

function highlightSnippet(snippet: string, query: string): string {
  let value = snippet.replace(/<</g, "««").replace(/>>/g, "»»");
  if (!value.includes("««")) {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp(escaped, "ig"), (match) => `««${match}»»`);
    }
  }
  if (value.length > 240) value = `${value.slice(0, 240)}…`;
  return value;
}

export function listSenders(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT sender FROM messages
       WHERE sender IS NOT NULL AND sender != ''
       ORDER BY sender COLLATE NOCASE`,
    )
    .all() as Array<{ sender: string }>;
  return rows.map((row) => row.sender);
}

export function stats(): { chats: number; messages: number; media: number } {
  const database = getDb();
  const chats = (database.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n: number }).n;
  const messages = (database.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;
  const media = (database.prepare("SELECT COUNT(*) AS n FROM attachments WHERE omitted = 0").get() as { n: number }).n;
  return { chats, messages, media };
}

export function listArchiveIssues(): Array<{ filename: string; reason: string; status: string }> {
  const rows = getDb()
    .prepare(
      `SELECT filename, error, status FROM archive_files
       WHERE status IN ('error', 'skipped', 'duplicate')
       ORDER BY filename COLLATE NOCASE`,
    )
    .all() as Array<{ filename: string; error: string | null; status: string }>;
  return rows.map((row) => ({
    filename: row.filename,
    status: row.status,
    reason: row.error || (row.status === "duplicate" ? "Duplicate of another export" : "Skipped"),
  }));
}

export function allArchivePaths(): string[] {
  return (getDb().prepare("SELECT path FROM archive_files").all() as Array<{ path: string }>).map((row) => row.path);
}

export { type AttachmentRow };
