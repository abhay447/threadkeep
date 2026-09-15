import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function resolveExistingPath(input: string): string {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return trimmed;
  const candidates = [toLocalFilesystemPath(trimmed)];
  if (/^\/mnt\/[a-zA-Z]\//.test(trimmed)) candidates.push(wslPathToWindows(trimmed));
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) candidates.push(windowsPathToWsl(trimmed));
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return candidates[0];
}

export function isPackaged(): boolean {
  if (process.env.WA_PACKAGED === "1") return true;
  if (Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg)) return true;
  try {
    const filePath = fileURLToPath(import.meta.url);
    return filePath.includes(`${path.sep}snapshot${path.sep}`) || filePath.startsWith("/snapshot/");
  } catch {
    return false;
  }
}

export function projectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

export function frontendDir(): string {
  if (process.env.WA_FRONTEND_DIR) return process.env.WA_FRONTEND_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packagedPublic = path.join(here, "public");
  if (fs.existsSync(path.join(packagedPublic, "index.html"))) return packagedPublic;
  const dist = path.join(projectRoot(), "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) return dist;
  return packagedPublic;
}

export function isPathInside(child: string, parent: string): boolean {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function defaultDataDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "WhatsAppArchiveViewer");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "WhatsAppArchiveViewer");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "whatsapp-archive-viewer");
}

export function getDataDir(): string {
  const fallback = defaultDataDir();
  const requested = process.env.WA_ARCHIVE_DATA_DIR?.trim();
  if (!requested) return fallback;
  const resolved = path.resolve(requested);
  if (isPathInside(resolved, projectRoot())) return fallback;
  return resolved;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
