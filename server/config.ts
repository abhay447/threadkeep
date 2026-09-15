import fs from "node:fs";
import path from "node:path";
import { ensureDir, getDataDir } from "./paths.js";

export interface AppConfig {
  archivePath: string | null;
  lastIndexed: string | null;
  ownerName: string | null;
  theme: "system" | "light" | "dark";
  version: number;
}

const DEFAULT_CONFIG: AppConfig = {
  archivePath: null,
  lastIndexed: null,
  ownerName: null,
  theme: "system",
  version: 1,
};

function configPath(): string {
  return path.join(getDataDir(), "config.json");
}

export function loadConfig(): AppConfig {
  ensureDir(getDataDir());
  const file = configPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...loadConfig(), ...patch };
  ensureDir(getDataDir());
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function dbPath(): string {
  return path.join(getDataDir(), "archive.db");
}

export function mediaCacheDir(): string {
  const dir = path.join(getDataDir(), "cache", "media");
  ensureDir(dir);
  return dir;
}
