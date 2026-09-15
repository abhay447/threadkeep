export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "contact"
  | "location"
  | "system"
  | "unknown";

export interface ParsedAttachment {
  filename: string;
  type: MessageType;
  omitted: boolean;
}

export interface ParsedMessage {
  timestamp: Date;
  sender: string | null;
  text: string;
  type: MessageType;
  attachment?: ParsedAttachment;
  rawText: string;
  isSystem: boolean;
  isDeleted: boolean;
  isEdited: boolean;
}

export interface ParseWarning {
  line: number;
  reason: string;
}

export interface ParseResult {
  messages: ParsedMessage[];
  warnings: ParseWarning[];
}

export interface ZipEntryInfo {
  fileName: string;
  uncompressedSize: number;
}

export type ImportStatus =
  | "pending"
  | "imported"
  | "skipped"
  | "duplicate"
  | "error";

export interface ImportProgress {
  phase: "idle" | "scan" | "index" | "complete" | "error";
  found: number;
  current: number;
  total: number;
  percent: number;
  currentFile: string | null;
  message: string;
  report: ImportReport | null;
}

export interface ImportReport {
  found: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: number;
  reused: number;
  skippedFiles: Array<{ filename: string; reason: string }>;
}

export interface ChatSummary {
  id: number;
  name: string;
  isGroup: boolean;
  messageCount: number;
  firstMessageAt: number | null;
  lastMessageAt: number | null;
  lastMessageText: string | null;
  lastMessageSender: string | null;
  mediaCount: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  documentCount: number;
  participantCount: number;
  participants: string[];
}

export interface MessageRow {
  id: number;
  chatId: number;
  seq: number;
  timestamp: number;
  sender: string | null;
  text: string;
  type: MessageType;
  isFromMe: boolean;
  isDeleted: boolean;
  isEdited: boolean;
  isSystem: boolean;
  isFirstOfDay: boolean;
  attachment: AttachmentRow | null;
}

export interface AttachmentRow {
  id: number;
  filename: string;
  mimeType: string | null;
  size: number | null;
  omitted: boolean;
  type: MessageType;
}

export interface SearchHit {
  messageId: number;
  chatId: number;
  chatName: string;
  seq: number;
  timestamp: number;
  sender: string | null;
  snippet: string;
  type: MessageType;
}
