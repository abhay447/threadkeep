import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface EmbeddedFile {
  mime: string;
  data: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

let manifest: Record<string, EmbeddedFile> | null = null;

function loadManifest(): Record<string, EmbeddedFile> {
  if (manifest) return manifest;
  const injected = (globalThis as { __WA_UI__?: Record<string, EmbeddedFile> }).__WA_UI__;
  if (injected && Object.keys(injected).length) {
    manifest = injected;
    return manifest;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, "ui.json");
  try {
    if (fs.existsSync(file)) {
      manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, EmbeddedFile>;
      return manifest;
    }
  } catch {
    // Fall back to files on disk.
  }
  manifest = {};
  return manifest;
}

export function hasEmbeddedUi(): boolean {
  return Object.keys(loadManifest()).length > 0;
}

export function getEmbeddedFile(urlPath: string): { mime: string; body: Buffer } | null {
  const files = loadManifest();
  const clean = urlPath.split("?")[0].split("#")[0];
  const key = clean === "/" || clean === "" ? "/index.html" : clean;
  const entry = files[key] || files[`/${key.replace(/^\//, "")}`];
  if (entry) return { mime: entry.mime || MIME[path.extname(key)] || "application/octet-stream", body: Buffer.from(entry.data, "base64") };
  if (!path.extname(key) && files["/index.html"]) {
    const index = files["/index.html"];
    return { mime: index.mime, body: Buffer.from(index.data, "base64") };
  }
  return null;
}

export function mimeFor(filename: string): string {
  return MIME[path.extname(filename).toLowerCase()] || "application/octet-stream";
}
