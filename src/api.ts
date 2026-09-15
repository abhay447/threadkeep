import type { AppStatus, ChatSummary, ImportProgress, MessageRow, SearchHit } from "./types";

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  const response = await res;
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  status: () => json<AppStatus>(fetch("/api/status")),
  selectFolder: (folderPath?: string) =>
    json<{ archivePath: string }>(
      fetch("/api/select-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(folderPath ? { path: folderPath } : {}),
      }),
    ),
  startImport: () =>
    json<{ started: boolean; alreadyRunning?: boolean }>(
      fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    ),
  chats: (q?: string) =>
    json<{ chats: ChatSummary[] }>(fetch(`/api/chats${q ? `?q=${encodeURIComponent(q)}` : ""}`)),
  chat: (id: number) => json<ChatSummary>(fetch(`/api/chats/${id}`)),
  messages: (chatId: number, offset: number, limit: number) =>
    json<{ messages: MessageRow[] }>(fetch(`/api/chats/${chatId}/messages?offset=${offset}&limit=${limit}`)),
  messageIndex: (chatId: number, messageId: number) =>
    json<{ seq: number }>(fetch(`/api/chats/${chatId}/messages/${messageId}/index`)),
  search: (params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) q.set(key, value);
    }
    return json<{ results: SearchHit[] }>(fetch(`/api/search?${q.toString()}`));
  },
  senders: () => json<{ senders: string[] }>(fetch("/api/senders")),
  setTheme: (theme: "light" | "dark" | "system") =>
    json<unknown>(
      fetch("/api/settings/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      }),
    ),
};

export function subscribeImport(onData: (progress: ImportProgress) => void): () => void {
  const source = new EventSource("/api/import/stream");
  source.onmessage = (event) => {
    onData(JSON.parse(event.data) as ImportProgress);
  };
  return () => source.close();
}

export function mediaUrl(id: number): string {
  return `/api/media/${id}`;
}

export function mediaDownloadUrl(id: number): string {
  return `/api/media/${id}/download`;
}
