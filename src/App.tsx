import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, subscribeImport } from "./api";
import { Conversation } from "./Conversation";
import { avatarColor, formatChatListTime, initials, renderSnippet } from "./format";
import type { AppStatus, ChatSummary, ImportProgress, SearchHit } from "./types";

type Screen = "loading" | "welcome" | "missing" | "importing" | "ready" | "error";

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatQuery, setChatQuery] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [globalSearch, setGlobalSearch] = useState(false);
  const [chatSearch, setChatSearch] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [filters, setFilters] = useState({ sender: "", after: "", before: "", hasMedia: false, mediaType: "" });
  const [jump, setJump] = useState<{ chatId: number; seq: number; messageId: number } | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const theme = status?.theme || "system";
  useEffect(() => {
    const dark =
      theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [theme]);

  const refreshStatus = async () => {
    const next = await api.status();
    setStatus(next);
    return next;
  };

  const loadChats = async (q?: string) => {
    const { chats: rows } = await api.chats(q);
    setChats(rows);
    return rows;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await refreshStatus();
        if (cancelled) return;
        if (next.folder === "none") setScreen("welcome");
        else if (next.folder === "missing") setScreen("missing");
        else {
          if (next.stats.chats === 0 || !next.lastIndexed) {
            setScreen("importing");
            await api.startImport();
          } else {
            await loadChats();
            setScreen("ready");
            api.startImport().catch(() => undefined);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start");
        setScreen("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeImport((state) => {
      setProgress(state);
      if (state.phase === "complete") {
        loadChats().then(() => {
          setScreen("ready");
          if (state.report && (state.report.imported > 0 || state.report.errors > 0) && (state.report.skipped || state.report.errors || state.report.duplicates)) {
            setShowReport(true);
          }
        });
        refreshStatus().catch(() => undefined);
      }
      if (state.phase === "error") {
        setError(state.message || "Import failed");
        setScreen("error");
      }
      if (state.phase === "scan" || state.phase === "index") {
        setScreen((current) => (current === "welcome" || current === "missing" ? "importing" : current));
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setGlobalSearch(true);
        setChatSearch(false);
        setTimeout(() => searchInputRef.current?.focus(), 20);
      }
      if (event.key === "Escape") {
        setGlobalSearch(false);
        setChatSearch(false);
        setShowSettings(false);
        setShowInfo(false);
      }
      if ((globalSearch || chatSearch) && searchHits.length) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSearchIndex((value) => Math.min(searchHits.length - 1, value + 1));
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSearchIndex((value) => Math.max(0, value - 1));
        }
        if (event.key === "Enter") {
          event.preventDefault();
          openHit(searchHits[searchIndex]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [globalSearch, chatSearch, searchHits, searchIndex]);

  useEffect(() => {
    if (!globalSearch && !chatSearch) return;
    const handle = setTimeout(() => {
      if (!searchQ.trim() && !filters.sender && !filters.hasMedia) {
        setSearchHits([]);
        return;
      }
      api
        .search({
          q: searchQ.trim(),
          chatId: chatSearch && activeId ? String(activeId) : undefined,
          sender: filters.sender || undefined,
          after: filters.after || undefined,
          before: filters.before || undefined,
          hasMedia: filters.hasMedia ? "1" : undefined,
          mediaType: filters.mediaType || undefined,
        })
        .then((res) => {
          setSearchHits(res.results);
          setSearchIndex(0);
        })
        .catch(() => setSearchHits([]));
    }, 180);
    return () => clearTimeout(handle);
  }, [searchQ, filters, globalSearch, chatSearch, activeId]);

  const activeChat = useMemo(() => chats.find((chat) => chat.id === activeId) || null, [chats, activeId]);

  const chooseFolder = async () => {
    setBusy(true);
    setError("");
    try {
      await api.selectFolder();
      setScreen("importing");
      await api.startImport();
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") return;
      setError(err instanceof Error ? err.message : "Could not select that folder");
    } finally {
      setBusy(false);
    }
  };

  const openHit = (hit: SearchHit) => {
    setActiveId(hit.chatId);
    setJump({ chatId: hit.chatId, seq: hit.seq, messageId: hit.messageId });
    setMobileChatOpen(true);
    setGlobalSearch(false);
    setChatSearch(false);
  };

  const filteredChats = chats.filter((chat) => chat.name.toLowerCase().includes(chatQuery.toLowerCase()));

  if (screen === "loading") {
    return <Centered title="WhatsApp Archive" body="Starting…" />;
  }
  if (screen === "error") {
    return (
      <Centered
        title="Something went wrong"
        body={error || "The app could not continue."}
        action="Try again"
        onAction={() => window.location.reload()}
      />
    );
  }
  if (screen === "welcome") {
    return <Welcome onSelect={chooseFolder} busy={busy} error={error} />;
  }
  if (screen === "missing") {
    return (
      <Centered
        title="Your WhatsApp archive folder could not be found."
        body={status?.archivePath || "The previously selected folder is missing."}
        action="Select New Folder"
        onAction={chooseFolder}
        busy={busy}
      />
    );
  }
  if (screen === "importing") {
    return <ImportScreen progress={progress} />;
  }

  return (
    <div className={`flex h-full bg-[#d1d7db] dark:bg-black ${mobileChatOpen ? "sidebar-collapsed" : "sidebar-open"}`}>
      {progress && (progress.phase === "scan" || progress.phase === "index") ? (
        <div className="fixed left-0 right-0 top-0 z-20 bg-wa-green px-4 py-1 text-center text-xs text-white">
          Updating archive… {progress.percent}%{progress.total ? ` (${progress.current}/${progress.total})` : ""}
        </div>
      ) : null}
      <div className="mx-auto flex h-full w-full max-w-[1600px] overflow-hidden bg-wa-panel shadow-xl dark:bg-wa-panel-dark">
        <aside className="sidebar flex w-full max-w-[420px] flex-col border-r border-wa-line dark:border-wa-line-dark md:w-[38%]">
          <div className="flex h-[60px] items-center justify-between bg-wa-header px-4 dark:bg-wa-header-dark">
            <div>
              <div className="font-semibold">WhatsApp Archive</div>
              <div className="text-xs text-wa-muted dark:text-wa-muted-dark">
                {status?.stats.chats.toLocaleString()} chats · local only
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                className="rounded-full px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => {
                  setGlobalSearch(true);
                  setTimeout(() => searchInputRef.current?.focus(), 20);
                }}
                title="Search (Ctrl+K)"
              >
                ⌕
              </button>
              <button
                className="rounded-full px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                onClick={() => setShowSettings(true)}
                aria-label="Settings"
              >
                ⚙
              </button>
            </div>
          </div>
          <div className="bg-wa-panel px-3 py-2 dark:bg-wa-panel-dark">
            <input
              className="w-full rounded-lg bg-wa-search px-3 py-2 text-sm outline-none dark:bg-wa-search-dark"
              placeholder="Search chats"
              value={chatQuery}
              onChange={(event) => setChatQuery(event.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredChats.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-wa-muted">No chats match that search.</div>
            ) : (
              filteredChats.map((chat) => (
                <button
                  key={chat.id}
                  className={`flex w-full items-center gap-3 border-b border-wa-line px-3 py-3 text-left hover:bg-black/5 dark:border-wa-line-dark dark:hover:bg-white/5 ${
                    chat.id === activeId ? "bg-[#f0f2f5] dark:bg-[#2a3942]" : ""
                  }`}
                  onClick={() => {
                    setActiveId(chat.id);
                    setJump(null);
                    setShowInfo(false);
                    setMobileChatOpen(true);
                  }}
                >
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ background: avatarColor(chat.name) }}
                  >
                    {chat.isGroup ? "👥" : initials(chat.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="truncate font-medium">{chat.name}</div>
                      <div className="shrink-0 text-[12px] text-wa-muted">{formatChatListTime(chat.lastMessageAt)}</div>
                    </div>
                    <div className="truncate text-sm text-wa-muted dark:text-wa-muted-dark">
                      {chat.lastMessageSender && chat.isGroup ? `${chat.lastMessageSender}: ` : ""}
                      {chat.lastMessageText || " "}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {activeChat ? (
          <Conversation
            chat={activeChat}
            jumpSeq={jump && jump.chatId === activeChat.id ? jump.seq : null}
            highlight={chatSearch ? searchQ : undefined}
            highlightedId={jump && jump.chatId === activeChat.id ? jump.messageId : null}
            onBack={() => setMobileChatOpen(false)}
            onOpenInfo={() => setShowInfo(true)}
            onOpenSearch={() => {
              setChatSearch(true);
              setGlobalSearch(false);
              setTimeout(() => searchInputRef.current?.focus(), 20);
            }}
          />
        ) : (
          <div className="conversation hidden flex-1 items-center justify-center bg-[#f0f2f5] text-wa-muted md:flex dark:bg-wa-bg-dark">
            <div className="max-w-md px-8 text-center">
              <div className="mb-3 text-3xl">💬</div>
              <h2 className="mb-2 text-2xl font-light text-slate-700 dark:text-slate-200">Select a chat</h2>
              <p className="text-sm">
                Your archive is processed locally on this computer. No chat data is uploaded or sent to the internet.
              </p>
            </div>
          </div>
        )}

        {showInfo && activeChat ? <ChatInfo chat={activeChat} onClose={() => setShowInfo(false)} /> : null}
      </div>

      {showSettings && status ? (
        <Modal title="Settings" onClose={() => setShowSettings(false)}>
          <div className="space-y-4 text-sm">
            <div>
              <div className="mb-1 font-medium">Archive folder</div>
              <div className="break-all rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">{status.archivePath}</div>
              <button className="mt-2 text-wa-green-dark dark:text-wa-accent" onClick={chooseFolder}>
                Change folder
              </button>
            </div>
            <div>
              <div className="mb-1 font-medium">Appearance</div>
              <div className="flex gap-2">
                {(["system", "light", "dark"] as const).map((value) => (
                  <button
                    key={value}
                    className={`rounded-full px-3 py-1 capitalize ${theme === value ? "bg-wa-green text-white" : "bg-black/5 dark:bg-white/5"}`}
                    onClick={() => api.setTheme(value).then(refreshStatus)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-wa-muted dark:text-wa-muted-dark">{status.privacy}</p>
          </div>
        </Modal>
      ) : null}

      {(globalSearch || chatSearch) && (
        <Modal
          title={chatSearch ? "Search in this chat" : "Search all chats"}
          onClose={() => {
            setGlobalSearch(false);
            setChatSearch(false);
          }}
        >
          <input
            ref={searchInputRef}
            className="mb-3 w-full rounded-lg bg-black/5 px-3 py-2 outline-none dark:bg-white/10"
            placeholder={chatSearch ? "Search in this chat" : "Search messages"}
            value={searchQ}
            onChange={(event) => setSearchQ(event.target.value)}
          />
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <input
              className="rounded-lg bg-black/5 px-2 py-1 dark:bg-white/10"
              placeholder="Sender"
              value={filters.sender}
              onChange={(event) => setFilters({ ...filters, sender: event.target.value })}
            />
            <input
              type="date"
              className="rounded-lg bg-black/5 px-2 py-1 dark:bg-white/10"
              value={filters.after}
              onChange={(event) => setFilters({ ...filters, after: event.target.value })}
            />
            <input
              type="date"
              className="rounded-lg bg-black/5 px-2 py-1 dark:bg-white/10"
              value={filters.before}
              onChange={(event) => setFilters({ ...filters, before: event.target.value })}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.hasMedia}
                onChange={(event) => setFilters({ ...filters, hasMedia: event.target.checked })}
              />
              Has media
            </label>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {searchHits.length === 0 ? (
              <div className="py-8 text-center text-sm text-wa-muted">
                {searchQ.trim() ? "No matching messages." : "Type to search. Press Esc to close."}
              </div>
            ) : (
              searchHits.map((hit, index) => (
                <button
                  key={`${hit.chatId}-${hit.messageId}`}
                  className={`block w-full border-b border-wa-line px-2 py-3 text-left dark:border-wa-line-dark ${
                    index === searchIndex ? "bg-black/5 dark:bg-white/5" : ""
                  }`}
                  onClick={() => openHit(hit)}
                >
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{hit.chatName}</span>
                    <span className="text-wa-muted">{formatChatListTime(hit.timestamp)}</span>
                  </div>
                  <div className="text-xs text-wa-muted">{hit.sender}</div>
                  <div className="text-sm" dangerouslySetInnerHTML={renderSnippet(hit.snippet)} />
                </button>
              ))
            )}
          </div>
        </Modal>
      )}

      {showReport && progress?.report ? (
        <Modal title="Import complete" onClose={() => setShowReport(false)}>
          <div className="space-y-2 text-sm">
            <p>{progress.report.found} chats found</p>
            <p>{progress.report.imported + progress.report.reused} imported successfully</p>
            <p>
              {progress.report.skipped + progress.report.errors + progress.report.duplicates} skipped
              {progress.report.duplicates ? ` (${progress.report.duplicates} duplicates)` : ""}
            </p>
            {progress.report.skippedFiles.length ? (
              <details>
                <summary className="cursor-pointer text-wa-green-dark">View skipped files</summary>
                <ul className="mt-2 max-h-48 overflow-auto text-xs">
                  {progress.report.skippedFiles.map((file) => (
                    <li key={file.filename} className="border-t border-wa-line py-2 dark:border-wa-line-dark">
                      <div className="font-medium">{file.filename}</div>
                      <div className="text-wa-muted">{file.reason}</div>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Welcome({ onSelect, busy, error }: { onSelect: () => void; busy: boolean; error: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-wa-bg dark:bg-wa-bg-dark">
      <div className="max-w-lg rounded-2xl bg-white p-10 text-center shadow-xl dark:bg-wa-panel-dark">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-wa-green text-3xl text-white">
          💬
        </div>
        <h1 className="mb-3 text-3xl font-light">WhatsApp Archive</h1>
        <p className="mb-2 text-wa-muted dark:text-wa-muted-dark">
          Browse your exported WhatsApp chats privately on this computer.
        </p>
        <p className="mb-6 text-sm text-wa-muted dark:text-wa-muted-dark">
          Your data stays on this computer and is never uploaded.
        </p>
        <button
          className="rounded-full bg-wa-green px-5 py-2.5 font-medium text-white disabled:opacity-60"
          onClick={onSelect}
          disabled={busy}
        >
          {busy ? "Opening folder picker…" : "Select WhatsApp Archive Folder"}
        </button>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

function ImportScreen({ progress }: { progress: ImportProgress | null }) {
  const percent = progress?.percent ?? 0;
  return (
    <div className="flex h-full items-center justify-center bg-wa-bg dark:bg-wa-bg-dark">
      <div className="w-full max-w-lg rounded-2xl bg-white p-10 shadow-xl dark:bg-wa-panel-dark">
        <h1 className="mb-2 text-2xl font-light">Indexing your chats</h1>
        <p className="mb-6 text-sm text-wa-muted dark:text-wa-muted-dark">
          {progress?.found ? `Found ${progress.found} chat exports` : "Looking for chat exports…"}
        </p>
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div className="h-full bg-wa-green transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm">
          {percent}%{progress?.total ? ` — ${progress.current} / ${progress.total}` : ""}
        </p>
        <p className="mt-2 text-xs text-wa-muted">This may take a few minutes the first time.</p>
        {progress?.currentFile ? (
          <p className="mt-3 truncate text-xs text-wa-muted">Current: {progress.currentFile}</p>
        ) : null}
      </div>
    </div>
  );
}

function Centered({
  title,
  body,
  action,
  onAction,
  busy,
}: {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-wa-bg dark:bg-wa-bg-dark">
      <div className="max-w-lg rounded-2xl bg-white p-10 text-center shadow-xl dark:bg-wa-panel-dark">
        <h1 className="mb-3 text-2xl font-light">{title}</h1>
        <p className="mb-6 break-all text-sm text-wa-muted dark:text-wa-muted-dark">{body}</p>
        {action && onAction ? (
          <button className="rounded-full bg-wa-green px-5 py-2.5 text-white disabled:opacity-60" onClick={onAction} disabled={busy}>
            {busy ? "Working…" : action}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 pt-16" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl dark:bg-wa-panel-dark"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">{title}</h2>
          <button className="text-wa-muted" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ChatInfo({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  return (
    <aside className="hidden w-[320px] border-l border-wa-line bg-wa-panel p-5 md:block dark:border-wa-line-dark dark:bg-wa-panel-dark">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium">Chat info</h2>
        <button onClick={onClose} aria-label="Close info">
          ✕
        </button>
      </div>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs text-wa-muted">Name</div>
          <div className="font-medium">{chat.name}</div>
        </div>
        <div>{chat.isGroup ? "Group chat" : "Personal chat"}</div>
        <div>{chat.messageCount.toLocaleString()} messages</div>
        <div>{chat.mediaCount.toLocaleString()} media items</div>
        <div>
          {chat.imageCount} photos · {chat.videoCount} videos · {chat.audioCount} audio · {chat.documentCount} files
        </div>
        {chat.firstMessageAt ? <div>First message {new Date(chat.firstMessageAt).toLocaleDateString()}</div> : null}
        {chat.lastMessageAt ? <div>Last message {new Date(chat.lastMessageAt).toLocaleDateString()}</div> : null}
        <div>
          <div className="mb-1 text-xs text-wa-muted">Participants ({chat.participants.length})</div>
          <ul className="max-h-64 overflow-auto">
            {chat.participants.map((name) => (
              <li key={name} className="py-1">
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
