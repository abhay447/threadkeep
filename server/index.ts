import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import express from "express";
import { build } from "vite";
import { loadConfig, saveConfig } from "./config.js";
import { FolderPickCancelled, pickFolder } from "./folderPicker.js";
import {
  getChat,
  getDb,
  getMessageIndex,
  getMessages,
  listChats,
  listSenders,
  resetDatabase,
  searchMessages,
  stats,
} from "./db.js";
import { getImportProgress, importArchive, isImportRunning, subscribeImport } from "./importer.js";
import { materializeAttachment } from "./media.js";
import { toLocalFilesystemPath } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 4783);
const HOST = "127.0.0.1";

async function ensureFrontend(): Promise<void> {
  const dist = path.join(ROOT, "dist", "index.html");
  if (fs.existsSync(dist)) return;
  if (process.env.WA_SKIP_BUILD === "1") return;
  process.stdout.write("Preparing the app for first use. This only happens once…\n");
  await build({
    root: ROOT,
    logLevel: "error",
  });
}

function folderStatus(archivePath: string | null): "none" | "missing" | "ready" {
  if (!archivePath) return "none";
  try {
    if (fs.existsSync(archivePath) && fs.statSync(archivePath).isDirectory()) return "ready";
  } catch {
    return "missing";
  }
  return "missing";
}

export async function createApp() {
  getDb();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.get("/api/status", (_req, res) => {
    const config = loadConfig();
    const folder = folderStatus(config.archivePath);
    res.json({
      folder,
      archivePath: config.archivePath,
      lastIndexed: config.lastIndexed,
      ownerName: config.ownerName,
      theme: config.theme,
      stats: folder === "ready" ? stats() : { chats: 0, messages: 0, media: 0 },
      import: getImportProgress(),
      privacy:
        "Your archive is processed locally on this computer. No chat data is uploaded or sent to the internet.",
    });
  });

  app.post("/api/settings/theme", (req, res) => {
    const theme = req.body?.theme;
    if (theme !== "light" && theme !== "dark" && theme !== "system") {
      res.status(400).json({ error: "Invalid theme" });
      return;
    }
    res.json(saveConfig({ theme }));
  });

  app.post("/api/select-folder", async (req, res) => {
    try {
      let selected: string;
      if (process.env.WA_ALLOW_PATH === "1" && typeof req.body?.path === "string") {
        selected = toLocalFilesystemPath(req.body.path);
      } else {
        selected = await pickFolder();
      }
      if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) {
        res.status(400).json({ error: "That folder could not be found." });
        return;
      }
      const previous = loadConfig().archivePath;
      if (previous && previous !== selected) resetDatabase();
      saveConfig({ archivePath: selected, lastIndexed: null });
      res.json({ archivePath: selected });
    } catch (error) {
      if (error instanceof FolderPickCancelled) {
        res.status(409).json({ error: "cancelled" });
        return;
      }
      res.status(500).json({
        error: error instanceof Error ? error.message : "Could not open the folder picker",
      });
    }
  });

  app.post("/api/import", async (req, res) => {
    const config = loadConfig();
    const archivePath =
      process.env.WA_ALLOW_PATH === "1" && typeof req.body?.path === "string"
        ? toLocalFilesystemPath(req.body.path)
        : config.archivePath;
    if (!archivePath) {
      res.status(400).json({ error: "No archive folder selected" });
      return;
    }
    if (isImportRunning()) {
      res.json({ started: false, alreadyRunning: true });
      return;
    }
    if (process.env.WA_ALLOW_PATH === "1") {
      try {
        const report = await importArchive(archivePath);
        res.json({ started: true, report });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : "Import failed" });
      }
      return;
    }
    importArchive(archivePath).catch(() => undefined);
    res.json({ started: true });
  });

  app.get("/api/import/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    const unsubscribe = subscribeImport((state) => {
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    });
    req.on("close", unsubscribe);
  });

  app.get("/api/chats", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    res.json({ chats: listChats(q) });
  });

  app.get("/api/chats/:id", (req, res) => {
    const chat = getChat(Number(req.params.id));
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    res.json(chat);
  });

  app.get("/api/chats/:id/messages", (req, res) => {
    const chatId = Number(req.params.id);
    const offset = Math.max(0, Number(req.query.offset || 0));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 80)));
    res.json({ messages: getMessages(chatId, offset, limit) });
  });

  app.get("/api/chats/:id/messages/:messageId/index", (req, res) => {
    const seq = getMessageIndex(Number(req.params.id), Number(req.params.messageId));
    if (seq == null) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    res.json({ seq });
  });

  app.get("/api/search", (req, res) => {
    const q = String(req.query.q || "");
    res.json({
      results: searchMessages({
        q,
        chatId: req.query.chatId ? Number(req.query.chatId) : undefined,
        sender: typeof req.query.sender === "string" && req.query.sender ? req.query.sender : undefined,
        after: req.query.after ? Date.parse(String(req.query.after)) : undefined,
        before: req.query.before ? Date.parse(String(req.query.before)) : undefined,
        hasMedia: req.query.hasMedia === "1" || req.query.hasMedia === "true",
        mediaType: typeof req.query.mediaType === "string" && req.query.mediaType ? req.query.mediaType : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 80,
      }),
    });
  });

  app.get("/api/senders", (_req, res) => {
    res.json({ senders: listSenders() });
  });

  app.get("/api/media/:id", async (req, res) => {
    try {
      const file = await materializeAttachment(Number(req.params.id));
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.filename)}"`);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.sendFile(path.resolve(file.filePath));
    } catch (error) {
      res.status(404).json({
        error: error instanceof Error ? error.message : "Media unavailable",
      });
    }
  });

  app.get("/api/media/:id/download", async (req, res) => {
    try {
      const file = await materializeAttachment(Number(req.params.id));
      res.download(file.filePath, file.filename);
    } catch (error) {
      res.status(404).json({
        error: error instanceof Error ? error.message : "Media unavailable",
      });
    }
  });

  const distDir = path.join(ROOT, "dist");
  if (fs.existsSync(path.join(distDir, "index.html"))) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}

async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    // Opening the browser is optional.
  }
}

async function main(): Promise<void> {
  if (process.env.WA_TEST_SERVER === "1") return;
  await ensureFrontend();
  const app = await createApp();
  const server = createServer(app);
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    process.stdout.write(`WhatsApp Archive Viewer is running at ${url}\n`);
    process.stdout.write("Your data stays on this computer and is never uploaded.\n");
    if (process.env.WA_NO_OPEN !== "1") {
      openBrowser(url).catch(() => undefined);
    }
  });
}

const isDirectRun = process.argv[1] && path.basename(process.argv[1]).startsWith("index");
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
}
