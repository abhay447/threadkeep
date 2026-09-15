export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatChatListTime(ts: number | null): string {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayMs = 86400000;
  if (startThat === startToday) return formatClock(ts);
  if (startThat === startToday - dayMs) return "Yesterday";
  if (now.getTime() - ts < dayMs * 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function formatDateSeparator(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayMs = 86400000;
  if (startThat === startToday) return "TODAY";
  if (startThat === startToday - dayMs) return "YESTERDAY";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }).toUpperCase();
}

export function formatBytes(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "?";
}

export function avatarColor(name: string): string {
  const palette = ["#02a698", "#34b7f1", "#e542a3", "#df3333", "#a844cb", "#fa6533", "#1fa855", "#b4876e"];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

export function renderSnippet(snippet: string): { __html: string } {
  const escaped = snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return {
    __html: escaped.replace(/««/g, '<mark class="mark-hit">').replace(/»»/g, "</mark>"),
  };
}
