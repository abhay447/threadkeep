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

export interface AttachmentRow {
  id: number;
  filename: string;
  mimeType: string | null;
  size: number | null;
  omitted: boolean;
  type: MessageType;
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

export interface AppStatus {
  folder: "none" | "missing" | "ready";
  archivePath: string | null;
  lastIndexed: string | null;
  ownerName: string | null;
  theme: "system" | "light" | "dark";
  stats: { chats: number; messages: number; media: number };
  import: ImportProgress;
  privacy: string;
}
