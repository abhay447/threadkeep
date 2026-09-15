import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AttachmentRow, ChatSummary, MessageRow } from "./types";
import { api } from "./api";
import { formatDateSeparator } from "./format";
import { MessageBubble } from "./MessageBubble";

const WINDOW = 80;

function estimateRowSize(message?: MessageRow): number {
  if (!message) return 72;
  let size = 8;
  if (message.isFirstOfDay) size += 36;
  if (message.isSystem) return size + 40;
  if (!message.text.trim() && !message.attachment && !message.isDeleted) return size + 56;
  if (message.attachment && (message.type === "image" || message.type === "video")) size += 240;
  else if (message.attachment && message.type === "sticker") size += 140;
  else if (message.attachment) size += 76;
  if (message.text.trim()) size += 28 + Math.min(160, Math.ceil(message.text.length / 46) * 19);
  return Math.max(size, 56);
}

export function Conversation({
  chat,
  jumpSeq,
  highlight,
  highlightedId,
  onBack,
  onOpenInfo,
  onOpenSearch,
}: {
  chat: ChatSummary;
  jumpSeq: number | null;
  highlight?: string;
  highlightedId?: number | null;
  onBack: () => void;
  onOpenInfo: () => void;
  onOpenSearch: () => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef(new Map<number, MessageRow>());
  const inflight = useRef(new Set<string>());
  const [, setTick] = useState(0);
  const [lightbox, setLightbox] = useState<AttachmentRow | null>(null);
  const didInitialScroll = useRef<number | null>(null);
  const jumpedTo = useRef<string | null>(null);
  const virtualizerRef = useRef<{ measure: () => void }>({ measure: () => undefined });

  const count = chat.messageCount;

  const loadRange = useCallback(
    async (start: number, end: number) => {
      const from = Math.max(0, start);
      const to = Math.min(count - 1, end);
      if (to < from) return;
      let missingFrom = -1;
      let missingTo = -1;
      for (let i = from; i <= to; i += 1) {
        if (!cacheRef.current.has(i)) {
          if (missingFrom === -1) missingFrom = i;
          missingTo = i;
        }
      }
      if (missingFrom === -1) return;
      const offset = missingFrom;
      const limit = Math.max(WINDOW, missingTo - missingFrom + 1);
      const key = `${chat.id}:${offset}:${limit}`;
      if (inflight.current.has(key)) return;
      inflight.current.add(key);
      try {
        const { messages } = await api.messages(chat.id, offset, limit);
        for (const message of messages) cacheRef.current.set(message.seq, message);
        setTick((value) => value + 1);
        requestAnimationFrame(() => virtualizerRef.current.measure());
      } finally {
        inflight.current.delete(key);
      }
    },
    [chat.id, count],
  );

  useEffect(() => {
    cacheRef.current = new Map();
    inflight.current = new Set();
    didInitialScroll.current = null;
    jumpedTo.current = null;
    setTick((value) => value + 1);
  }, [chat.id]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateRowSize(cacheRef.current.get(index)),
    overscan: 24,
    gap: 6,
    getItemKey: (index) => `${chat.id}-${index}`,
    measureElement: (element) => {
      const height = element.getBoundingClientRect().height;
      if (height > 1) return Math.ceil(height);
      return estimateRowSize(cacheRef.current.get(Number(element.dataset.index)));
    },
  });
  virtualizerRef.current = virtualizer;

  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    if (!items.length) return;
    const start = items[0].index;
    const end = items[items.length - 1].index;
    loadRange(start - 20, end + 20).catch(() => undefined);
  }, [items, loadRange]);

  useEffect(() => {
    if (!count) return;
    if (jumpSeq != null) {
      const key = `${chat.id}:${jumpSeq}`;
      if (jumpedTo.current === key) return;
      jumpedTo.current = key;
      virtualizer.scrollToIndex(Math.min(count - 1, Math.max(0, jumpSeq)), { align: "center" });
      return;
    }
    if (didInitialScroll.current === chat.id) return;
    didInitialScroll.current = chat.id;
    const frame = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(count - 1, { align: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chat.id, count, jumpSeq, virtualizer]);

  const images = [...cacheRef.current.values()]
    .filter((message) => message.attachment && (message.type === "image" || message.type === "sticker") && !message.attachment.omitted)
    .map((message) => message.attachment!)
    .sort((a, b) => a.id - b.id);

  return (
    <section className="conversation flex min-w-0 flex-1 flex-col bg-wa-bg text-wa-ink dark:bg-wa-bg-dark dark:text-wa-ink-dark">
      <header className="flex h-[60px] items-center gap-3 border-b border-wa-line bg-wa-header px-3 text-wa-ink dark:border-wa-line-dark dark:bg-wa-header-dark dark:text-wa-ink-dark">
        <button className="rounded-full p-2 text-wa-muted md:hidden" onClick={onBack} aria-label="Back to chats">
          ←
        </button>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ background: chat.isGroup ? "#00a884" : "#6b7c85" }}
        >
          {chat.isGroup ? "👥" : chat.name.slice(0, 1).toUpperCase()}
        </div>
        <button className="min-w-0 flex-1 text-left" onClick={onOpenInfo}>
          <div className="truncate font-medium">{chat.name}</div>
          <div className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">
            {chat.isGroup
              ? `${chat.participantCount} participants · ${chat.messageCount.toLocaleString()} messages`
              : `${chat.messageCount.toLocaleString()} messages`}
          </div>
        </button>
        <button
          className="rounded-full px-3 py-1.5 text-sm text-wa-muted hover:bg-black/5 dark:hover:bg-white/5"
          onClick={onOpenSearch}
        >
          Search
        </button>
      </header>

      <div ref={parentRef} className="chat-wallpaper min-h-0 flex-1 overflow-y-auto">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const message = cacheRef.current.get(item.index);
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 box-border w-full px-4 md:px-12"
                style={{ top: 0, transform: `translateY(${item.start}px)` }}
              >
                {message ? (
                  <>
                    {message.isFirstOfDay ? (
                      <div className="mb-2 flex justify-center">
                        <span className="rounded-lg bg-[#ffeaa7] px-3 py-1 text-[12px] font-semibold uppercase tracking-wide text-wa-ink shadow-bubble dark:bg-[#182229] dark:text-wa-ink-dark">
                          {formatDateSeparator(message.timestamp)}
                        </span>
                      </div>
                    ) : null}
                    <MessageBubble
                      message={message}
                      showSender={chat.isGroup && !message.isFromMe}
                      highlight={highlight}
                      highlighted={highlightedId === message.id}
                      onOpenImage={setLightbox}
                      onMediaLoaded={() => virtualizer.measure()}
                    />
                  </>
                ) : (
                  <div className="h-12 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {lightbox ? (
        <Lightbox
          current={lightbox}
          images={images.length ? images : [lightbox]}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  );
}

function Lightbox({
  current,
  images,
  onClose,
}: {
  current: AttachmentRow;
  images: AttachmentRow[];
  onClose: () => void;
}) {
  const index = Math.max(0, images.findIndex((image) => image.id === current.id));
  const [cursor, setCursor] = useState(index);
  const image = images[cursor] || current;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setCursor((value) => Math.min(images.length - 1, value + 1));
      if (event.key === "ArrowLeft") setCursor((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="truncate text-sm">{image.filename}</div>
        <button className="rounded-full px-3 py-1 text-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-4 px-4" onClick={(event) => event.stopPropagation()}>
        <button
          className="rounded-full bg-white/10 px-3 py-2 text-white disabled:opacity-30"
          disabled={cursor <= 0}
          onClick={() => setCursor((value) => value - 1)}
        >
          ←
        </button>
        <img src={`/api/media/${image.id}`} alt={image.filename} className="max-h-full max-w-full object-contain" />
        <button
          className="rounded-full bg-white/10 px-3 py-2 text-white disabled:opacity-30"
          disabled={cursor >= images.length - 1}
          onClick={() => setCursor((value) => value + 1)}
        >
          →
        </button>
      </div>
    </div>
  );
}
