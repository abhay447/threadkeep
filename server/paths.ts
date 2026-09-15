import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const release = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    return release.includes("microsoft") || Boolean(process.env.WSL_DISTRO_NAME);
  } catch {
    return Boolean(process.env.WSL_DISTRO_NAME);
  }
}

export function windowsPathToWsl(windowsPath: string): string {
  const normalized = windowsPath.replace(/\\/g, "/").trim();
  const drive = /^([A-Za-z]):(\/.*)?$/.exec(normalized);
  if (!drive) return normalized;
  const rest = (drive[2] || "").replace(/^\/+/, "");
  return `/mnt/${drive[1].toLowerCase()}/${rest}`;
}

export function wslPathToWindows(wslPath: string): string {
  const match = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(wslPath);
  if (!match) return wslPath.replace(/\//g, "\\");
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
}

export function toLocalFilesystemPath(input: string): string {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return trimmed;
  if (isWsl() && /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return windowsPathToWsl(trimmed);
  }
  return trimmed;
}

export function getDataDir(): string {
  if (process.env.WA_ARCHIVE_DATA_DIR) {
    return path.resolve(process.env.WA_ARCHIVE_DATA_DIR);
  }
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "WhatsAppArchiveViewer");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "WhatsAppArchiveViewer");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "whatsapp-archive-viewer");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
