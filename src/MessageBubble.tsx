import { useEffect, useMemo, useRef, useState } from "react";
import type { AttachmentRow, MessageRow, MessageType } from "./types";
import { mediaDownloadUrl, mediaUrl } from "./api";
import { formatBytes, formatClock } from "./format";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatWhatsAppText(text: string, highlight?: string): string {
  let value = escapeHtml(text);
  value = value.replace(/\*(.+?)\*/g, "<strong>$1</strong>");
  value = value.replace(/_(.+?)_/g, "<em>$1</em>");
  value = value.replace(/~(.+?)~/g, "<s>$1</s>");
  value = value.replace(/```([\s\S]+?)```/g, "<code>$1</code>");
  value = value.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a class="text-sky-700 dark:text-sky-300 underline" href="$1" rel="noreferrer">$1</a>',
  );
  value = value.replace(/@\u2068(.+?)\u2069/g, '<span class="text-sky-700 dark:text-sky-300">@$1</span>');
  if (highlight?.trim()) {
    const terms = highlight.trim().split(/\s+/).filter(Boolean);
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp(`(${escaped})`, "ig"), '<mark class="mark-hit">$1</mark>');
    }
  }
  return value.replace(/\n/g, "<br/>");
}

function typeLabel(type: MessageType): string {
  switch (type) {
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    case "sticker":
      return "Sticker";
    case "document":
      return "Document";
    case "contact":
      return "Contact";
    case "location":
      return "Location";
    default:
      return "Message";
  }
}

export function MessageText({ text, highlight }: { text: string; highlight?: string }) {
  const html = useMemo(() => formatWhatsAppText(text, highlight), [text, highlight]);
  return <div className="whitespace-pre-wrap break-words text-[14.2px] leading-5" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MediaBlock({
  message,
  onOpenImage,
  onMediaLoaded,
}: {
  message: MessageRow;
  onOpenImage?: (attachment: AttachmentRow) => void;
  onMediaLoaded?: () => void;
}) {
  const attachment = message.attachment;
  if (!attachment) return null;
  if (attachment.omitted) {
    return <div className="text-sm italic text-wa-muted dark:text-wa-muted-dark">Media omitted from this export</div>;
  }

  if (message.type === "image" || message.type === "sticker") {
    return (
      <button
        type="button"
        className="block overflow-hidden rounded-lg"
        onClick={() => onOpenImage?.(attachment)}
        aria-label="Open image"
      >
        <img
          src={mediaUrl(attachment.id)}
          alt={attachment.filename}
          loading="lazy"
          onLoad={onMediaLoaded}
          className={message.type === "sticker" ? "max-h-40 max-w-[160px]" : "max-h-80 max-w-full object-contain"}
        />
      </button>
    );
  }

  if (message.type === "video") {
    return <LazyVideo attachment={attachment} />;
  }

  if (message.type === "audio") {
    return <AudioPlayer attachment={attachment} />;
  }

  if (message.type === "location") {
    return (
      <a
        className="text-sky-700 underline dark:text-sky-300"
        href={message.text.match(/https?:\/\/\S+/)?.[0]}
        rel="noreferrer"
      >
        View location
      </a>
    );
  }

  return (
    <div className="flex min-w-[220px] items-center gap-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-wa-green text-sm font-semibold text-white">
        {fileGlyph(attachment.filename)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{attachment.filename || typeLabel(message.type)}</div>
        <div className="text-xs text-wa-muted dark:text-wa-muted-dark">
          {[attachment.mimeType?.split("/")[1]?.toUpperCase(), formatBytes(attachment.size)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <a
        className="rounded-full px-2 py-1 text-xs font-medium text-wa-green-dark hover:bg-black/5 dark:text-wa-accent dark:hover:bg-white/5"
        href={mediaDownloadUrl(attachment.id)}
      >
        Save
      </a>
    </div>
  );
}

function fileGlyph(filename: string): string {
  const ext = filename.split(".").pop()?.toUpperCase() || "FILE";
  return ext.slice(0, 4);
}

function LazyVideo({ attachment }: { attachment: AttachmentRow }) {
  const [active, setActive] = useState(false);
  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setActive(true)}
        className="flex h-40 w-64 items-center justify-center rounded-lg bg-black/80 text-white"
        aria-label="Play video"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-2xl">▶</span>
      </button>
    );
  }
  return (
    <video className="max-h-80 max-w-full rounded-lg" controls preload="metadata" src={mediaUrl(attachment.id)} />
  );
}

function AudioPlayer({ attachment }: { attachment: AttachmentRow }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !ready) return;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnd = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnd);
    };
  }, [ready]);

  const toggle = () => {
    if (!ready) {
      setReady(true);
      setTimeout(() => audioRef.current?.play().then(() => setPlaying(true)).catch(() => undefined), 50);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => undefined);
    }
  };

  const stamp = (seconds: number) => {
    if (!seconds || !Number.isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex w-[250px] items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-wa-green text-white"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="flex-1">
        <div className="h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div
            className="h-full bg-wa-green"
            style={{ width: duration ? `${Math.min(100, (progress / duration) * 100)}%` : "0%" }}
          />
        </div>
        <div className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">{stamp(playing || progress ? progress : duration)}</div>
      </div>
      {ready ? <audio ref={audioRef} src={mediaUrl(attachment.id)} preload="metadata" /> : null}
    </div>
  );
}

export function MessageBubble({
  message,
  showSender,
  highlight,
  highlighted,
  onOpenImage,
  onMediaLoaded,
}: {
  message: MessageRow;
  showSender: boolean;
  highlight?: string;
  highlighted?: boolean;
  onOpenImage?: (attachment: AttachmentRow) => void;
  onMediaLoaded?: () => void;
}) {
  if (message.isSystem) {
    return (
      <div className="mx-auto max-w-[80%] rounded-lg bg-white/80 px-3 py-1.5 text-center text-[12.5px] text-wa-muted shadow-bubble dark:bg-[#182229] dark:text-wa-muted-dark">
        {message.text.replace(/\*Learn more\*/i, "").trim()}
      </div>
    );
  }

  if (!message.text && !message.attachment && !message.isDeleted) {
    return null;
  }

  const mine = message.isFromMe;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-lg px-2 py-1.5 shadow-bubble ${
          mine
            ? "bubble-out rounded-tr-none bg-wa-out dark:bg-wa-out-dark"
            : "bubble-in rounded-tl-none bg-wa-in dark:bg-wa-in-dark"
        } ${highlighted ? "ring-2 ring-amber-400" : ""}`}
      >
        {showSender && message.sender ? (
          <div className="mb-0.5 text-[12.5px] font-semibold text-wa-green-dark dark:text-wa-accent">{message.sender}</div>
        ) : null}
        {message.isDeleted ? (
          <div className="italic text-wa-muted dark:text-wa-muted-dark">This message was deleted</div>
        ) : (
          <>
            {message.attachment ? <MediaBlock message={message} onOpenImage={onOpenImage} onMediaLoaded={onMediaLoaded} /> : null}
            {message.text ? (
              <div className={message.attachment ? "mt-1" : ""}>
                <MessageText text={message.text} highlight={highlight} />
              </div>
            ) : null}
            {message.isEdited ? <div className="text-[11px] italic text-wa-muted">edited</div> : null}
          </>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
          <span>{formatClock(message.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}
