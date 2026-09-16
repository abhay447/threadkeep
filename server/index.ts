import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import express from "express";
import { loadConfig, saveConfig } from "./config.js";
import { cancelFolderPick, FolderPickCancelled, pickFolder } from "./folderPicker.js";
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
import { frontendDir, resolveExistingPath, toLocalFilesystemPath } from "./paths.js";
import { getEmbeddedFile, hasEmbeddedUi } from "./staticFiles.js";

const PORT = Number(process.env.PORT || 4783);
const HOST = "127.0.0.1";

export function listenUrl(): string {
  return `http://${HOST}:${PORT}`;
}

function folderStatus(archivePath: string | null): "none" | "missing" | "ready" {
  if (!archivePath) return "none";
  try {
    const resolved = resolveExistingPath(archivePath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return "ready";
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
      const requested = typeof req.body?.path === "string" ? req.body.path.trim() : "";
      if (requested) {
        cancelFolderPick();
        selected = toLocalFilesystemPath(requested);
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

  async function startImportResponse(archivePath: string, res: express.Response) {
    if (isImportRunning()) {
      res.json({ started: false, alreadyRunning: true });
      return;
    }
    if (process.env.THREADKEEP_ALLOW_PATH === "1") {
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
  }

  app.post("/api/import", async (req, res) => {
    const config = loadConfig();
    const archivePath =
      process.env.THREADKEEP_ALLOW_PATH === "1" && typeof req.body?.path === "string"
        ? toLocalFilesystemPath(req.body.path)
        : config.archivePath;
    if (!archivePath) {
      res.status(400).json({ error: "No archive folder selected" });
      return;
    }
    await startImportResponse(archivePath, res);
  });

  app.post("/api/reindex", async (_req, res) => {
    const config = loadConfig();
    if (!config.archivePath) {
      res.status(400).json({ error: "No archive folder selected" });
      return;
    }
    if (folderStatus(config.archivePath) !== "ready") {
      res.status(400).json({ error: "That folder could not be found." });
      return;
    }
    if (isImportRunning()) {
      res.status(409).json({ error: "Indexing is already running" });
      return;
    }
    resetDatabase();
    saveConfig({ lastIndexed: null });
    await startImportResponse(config.archivePath, res);
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

  if (hasEmbeddedUi()) {
    app.get("*", (req, res) => {
      const file = getEmbeddedFile(req.path);
      if (!file) {
        res.status(404).send("Not found");
        return;
      }
      res.setHeader("Content-Type", file.mime);
      res.send(file.body);
    });
  } else {
    const distDir = frontendDir();
    if (fs.existsSync(path.join(distDir, "index.html"))) {
      app.use(express.static(distDir));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distDir, "index.html"));
      });
    }
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

export async function startServer(): Promise<{ url: string }> {
  if (process.env.THREADKEEP_TEST_SERVER === "1") return { url: listenUrl() };
  const app = await createApp();
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, HOST, () => resolve());
    server.on("error", reject);
  });
  const url = listenUrl();
  process.stdout.write(`Threadkeep is running at ${url}\n`);
  process.stdout.write("Your data stays on this computer and is never uploaded.\n");
  const inElectron = Boolean(process.versions.electron);
  if (process.env.THREADKEEP_NO_OPEN !== "1" && !inElectron) {
    openBrowser(url).catch(() => undefined);
  }
  return { url };
}
