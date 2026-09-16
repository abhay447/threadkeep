import type { MessageType, ParsedAttachment, ParsedMessage, ParseResult, ParseWarning } from "./types.js";

/**
 * Chat TXT exports vary by OS and locale. This parser detects a message
 * start line by timestamp, then treats following unmatched lines as
 * continuations of the current message.
 */
const TIMESTAMP_RE =
  /^(\[)?(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[\s\u202f\u00a0\u200e\u200f]*(AM|PM|am|pm))?(\])?(?:\s*[-–—]\s+|\s+)(.*)$/;

const LRM = /[\u200e\u200f\u202a-\u202e]/g;
const NARROW_SPACE = /[\u202f\u00a0]/g;

const SYSTEM_PATTERNS: RegExp[] = [
  /^messages (and calls )?are end-to-end encrypted/i,
  /^messages to yourself are end-to-end encrypted/i,
  /^you created this group$/i,
  / created this group$/i,
  / created group "/i,
  / added you$/i,
  /^you were added$/i,
  / added .+/i,
  / were added$/i,
  / left$/i,
  / removed .+/i,
  / changed their phone number/i,
  / is a contact$/i,
  /^this business uses a secure service/i,
  / changed the subject/i,
  / changed this group's icon/i,
  / changed the group description/i,
  /^you're now an admin/i,
  / joined using this group's invite link/i,
  /^waiting for this message/i,
  / turned on disappearing messages/i,
  / turned off disappearing messages/i,
  / changed the group settings/i,
  /^you joined using/i,
  / changed to \+/i,
  /^encryption$/i,
];

const FILE_ATTACHED_RE = /^(.*?)\s+\(file attached\)\s*([\s\S]*)$/i;
const IOS_ATTACHED_RE = /^<attached:\s*(.+?)>$/i;
const MEDIA_OMITTED_RE =
  /^(?:<media omitted>|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|contact omitted)$/i;
const LOCATION_RE =
  /^(?:location:\s*)?(https?:\/\/(?:maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)\S+)/i;
const DELETED_RE = /^(?:this message was deleted|you deleted this message)$/i;
const EDITED_SUFFIX = /\s*<this message was edited>\s*$/i;

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".heic", ".heif", ".tif", ".tiff"]);
const VIDEO_EXT = new Set([".mp4", ".3gp", ".mov", ".avi", ".mkv", ".webm"]);
const AUDIO_EXT = new Set([".opus", ".ogg", ".mp3", ".m4a", ".wav", ".aac", ".amr", ".oga"]);
const STICKER_EXT = new Set([".webp"]);
const CONTACT_EXT = new Set([".vcf"]);

export function stripInvisible(value: string): string {
  return value.replace(LRM, "").replace(NARROW_SPACE, " ");
}

function normalizeYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function toHour24(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour;
  const flag = ampm.toLowerCase();
  if (flag === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function interpretDayMonth(first: number, second: number): { day: number; month: number } {
  if (first > 12 && second <= 12) return { day: first, month: second };
  if (second > 12 && first <= 12) return { day: second, month: first };
  // Ambiguous: Android India/EU chat exports are DD/MM.
  return { day: first, month: second };
}

export interface TimestampMatch {
  date: Date;
  rest: string;
}

export function matchTimestampLine(line: string): TimestampMatch | null {
  const cleaned = stripInvisible(line).trimEnd();
  const match = TIMESTAMP_RE.exec(cleaned);
  if (!match) return null;

  const openBracket = Boolean(match[1]);
  const closeBracket = Boolean(match[9]);
  if (openBracket !== closeBracket) return null;

  const first = Number(match[2]);
  const second = Number(match[3]);
  const year = normalizeYear(Number(match[4]));
  const { day, month } = interpretDayMonth(first, second);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const hour = toHour24(Number(match[5]), match[8]);
  const minute = Number(match[6]);
  const secondOfMinute = match[7] ? Number(match[7]) : 0;
  if (hour > 23 || minute > 59 || secondOfMinute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, secondOfMinute);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return { date, rest: match[10] ?? "" };
}

function isSystemRemainder(remainder: string): boolean {
  const text = remainder.trim();
  if (!text) return true;
  return SYSTEM_PATTERNS.some((pattern) => pattern.test(text));
}

function splitSender(remainder: string): { sender: string | null; body: string; isSystem: boolean } {
  const text = remainder.replace(/^\u200e/, "").trimStart();
  const match = /^(?!https?:\/\/)(.{1,80}?):\s(.*)$/s.exec(text) || /^(?!https?:\/\/)(.{1,80}?):$/.exec(text);
  if (match) {
    const sender = match[1].trim();
    const body = match[2] ?? "";
    if (sender && !sender.includes("://")) {
      return { sender, body, isSystem: false };
    }
  }
  return { sender: null, body: text, isSystem: true };
}

export function extensionOf(filename: string): string {
  const base = filename.trim().replace(/\.+$/, "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

export function messageTypeFromFilename(filename: string): MessageType {
  const ext = extensionOf(filename);
  const upper = filename.toUpperCase();
  if (upper.startsWith("STK-") || STICKER_EXT.has(ext)) return "sticker";
  if (upper.startsWith("IMG-") || IMAGE_EXT.has(ext)) return "image";
  if (upper.startsWith("VID-") || VIDEO_EXT.has(ext)) return "video";
  if (upper.startsWith("PTT-") || upper.startsWith("AUD-") || AUDIO_EXT.has(ext)) return "audio";
  if (CONTACT_EXT.has(ext)) return "contact";
  if (ext) return "document";
  if (upper.startsWith("DOC-")) return "document";
  return "unknown";
}

function omittedTypeFromPlaceholder(body: string): MessageType {
  const value = body.trim().toLowerCase();
  if (value.includes("image")) return "image";
  if (value.includes("video")) return "video";
  if (value.includes("audio")) return "audio";
  if (value.includes("sticker")) return "sticker";
  if (value.includes("gif")) return "image";
  if (value.includes("document")) return "document";
  if (value.includes("contact")) return "contact";
  return "unknown";
}

export function inspectMessageBody(body: string): {
  text: string;
  type: MessageType;
  attachment?: ParsedAttachment;
  isDeleted: boolean;
  isEdited: boolean;
} {
  let text = body.replace(/\r/g, "");
  const isEdited = EDITED_SUFFIX.test(text);
  if (isEdited) text = text.replace(EDITED_SUFFIX, "").trimEnd();

  const trimmedStart = text.trim();
  if (DELETED_RE.test(trimmedStart)) {
    return { text: trimmedStart, type: "text", isDeleted: true, isEdited };
  }

  const omitted = MEDIA_OMITTED_RE.test(trimmedStart);
  if (omitted) {
    const type = omittedTypeFromPlaceholder(trimmedStart);
    return {
      text: "",
      type,
      attachment: { filename: "", type, omitted: true },
      isDeleted: false,
      isEdited,
    };
  }

  const attached = FILE_ATTACHED_RE.exec(text) || FILE_ATTACHED_RE.exec(trimmedStart);
  if (attached) {
    const filename = attached[1].trim();
    const caption = attached[2].trim();
    const type = messageTypeFromFilename(filename);
    return {
      text: caption,
      type,
      attachment: { filename, type, omitted: false },
      isDeleted: false,
      isEdited,
    };
  }

  const iosAttached = IOS_ATTACHED_RE.exec(trimmedStart);
  if (iosAttached) {
    const filename = iosAttached[1].trim();
    const type = messageTypeFromFilename(filename);
    return {
      text: "",
      type,
      attachment: { filename, type, omitted: false },
      isDeleted: false,
      isEdited,
    };
  }

  const location = LOCATION_RE.exec(trimmedStart);
  if (location || /^location:\s+/i.test(trimmedStart)) {
    return { text: text.trim(), type: "location", isDeleted: false, isEdited };
  }

  return { text, type: "text", isDeleted: false, isEdited };
}

function finalizeMessage(partial: ParsedMessage): ParsedMessage {
  if (partial.isSystem) {
    return { ...partial, type: "system", sender: null };
  }
  const inspected = inspectMessageBody(partial.text);
  return {
    ...partial,
    text: inspected.text,
    type: inspected.type,
    attachment: inspected.attachment,
    isDeleted: inspected.isDeleted,
    isEdited: inspected.isEdited,
  };
}

export function parseChatExport(source: string): ParseResult {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  const messages: ParsedMessage[] = [];
  const warnings: ParseWarning[] = [];

  let current: ParsedMessage | null = null;

  const pushCurrent = () => {
    if (!current) return;
    messages.push(finalizeMessage(current));
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const stamped = matchTimestampLine(line);
    if (stamped) {
      pushCurrent();
      const split = splitSender(stamped.rest);
      current = {
        timestamp: stamped.date,
        sender: split.sender,
        text: split.body,
        type: split.isSystem ? "system" : "text",
        rawText: line,
        isSystem: split.isSystem,
        isDeleted: false,
        isEdited: false,
      };
      continue;
    }

    if (current) {
      current.text = current.text.length > 0 ? `${current.text}\n${line}` : line;
      current.rawText = `${current.rawText}\n${line}`;
    } else if (line.trim()) {
      warnings.push({ line: index + 1, reason: "unrecognized line before first message" });
    }
  }

  pushCurrent();
  return { messages, warnings };
}

export function chatNameFromFilename(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop() || filename;
  const withoutExt = base.replace(/\.(txt|zip)$/i, "");
  const cleaned = withoutExt.replace(/\s*\(\d+\)$/, "");
  const match = /^(?:WhatsApp Chat (?:with|de|con|avec|mit|com) )(.+)$/i.exec(cleaned);
  if (match) return match[1].trim();
  if (cleaned === "_chat") return "Chat";
  return cleaned.trim() || "Chat";
}

export function looksLikeChatTranscript(filename: string): boolean {
  const base = filename.replace(/\\/g, "/").split("/").pop() || filename;
  if (!base.toLowerCase().endsWith(".txt")) return false;
  if (/^whatsapp chat /i.test(base)) return true;
  if (base.toLowerCase() === "_chat.txt") return true;
  return false;
}

export function isGroupChat(messages: ParsedMessage[], participantCount: number): boolean {
  if (participantCount > 2) return true;
  return messages.some(
    (message) =>
      message.isSystem &&
      /created (this )?group|^you created this group$| added you$|^you were added$|joined using this group's invite link/i.test(
        message.text,
      ),
  );
}

export function uniqueSenders(messages: ParsedMessage[]): string[] {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.sender) names.add(message.sender);
  }
  return [...names];
}

function mediaDayKey(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function dayKeyFromFilename(filename: string): string | null {
  const base = filename.replace(/\\/g, "/").split("/").pop() || filename;
  const match = /(?:IMG|VID|PTT|AUD|STK|DOC|AUDIO|VIDEO)-(\d{8})-WA/i.exec(base) || /(\d{8})/.exec(base);
  return match ? match[1] : null;
}

const ORPHAN_MEDIA_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".mp4",
  ".3gp",
  ".mov",
  ".opus",
  ".ogg",
  ".mp3",
  ".m4a",
  ".pdf",
  ".doc",
  ".docx",
  ".vcf",
]);

/**
 * Some exports write a blank caption for photos/docs that still exist
 * in the ZIP. Attach those leftover files to empty messages on the same day.
 */
export function attachOrphanMedia(messages: ParsedMessage[], entryNames: string[]): number {
  const used = new Set<string>();
  for (const message of messages) {
    const name = message.attachment?.filename;
    if (name) used.add(name.replace(/\\/g, "/").split("/").pop()!.toLowerCase());
  }

  const byDay = new Map<string, string[]>();
  for (const entry of entryNames) {
    const normalized = entry.replace(/\\/g, "/");
    const base = normalized.split("/").pop() || normalized;
    if (looksLikeChatTranscript(base)) continue;
    if (!ORPHAN_MEDIA_EXT.has(extensionOf(base))) continue;
    if (used.has(base.toLowerCase())) continue;
    const day = dayKeyFromFilename(base);
    if (!day) continue;
    const list = byDay.get(day) || [];
    list.push(normalized);
    byDay.set(day, list);
  }
  for (const list of byDay.values()) list.sort();

  let linked = 0;
  for (const message of messages) {
    if (message.isSystem || message.isDeleted || message.attachment) continue;
    if (message.text.replace(/\s+/g, "").length) continue;
    const bucket = byDay.get(mediaDayKey(message.timestamp));
    if (!bucket?.length) continue;
    const file = bucket.shift()!;
    const filename = file.split("/").pop() || file;
    const type = messageTypeFromFilename(filename);
    message.attachment = { filename, type, omitted: false };
    message.type = type;
    message.text = "";
    linked += 1;
  }
  return linked;
}

export function mimeFromFilename(filename: string): string {
  const ext = extensionOf(filename);
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".mp4": "video/mp4",
    ".3gp": "video/3gpp",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".opus": "audio/ogg; codecs=opus",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".aac": "audio/aac",
    ".pdf": "application/pdf",
    ".vcf": "text/vcard",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".html": "text/html",
    ".zip": "application/zip",
  };
  return map[ext] || "application/octet-stream";
}
