import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../server/db.js";
import { createApp } from "../server/index.js";
import { materializeAttachment } from "../server/media.js";
import { getMessages, listChats } from "../server/db.js";

function writeZip(filePath: string, files: Record<string, string | Uint8Array>) {
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    encoded[name] = typeof value === "string" ? strToU8(value) : value;
  }
  fs.writeFileSync(filePath, zipSync(encoded));
}

describe("app flows", () => {
  let dataDir: string;
  let archiveDir: string;
  let app: Awaited<ReturnType<typeof createApp>>;
  const previousData = process.env.THREADKEEP_DATA_DIR;
  const previousAllow = process.env.THREADKEEP_ALLOW_PATH;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-api-"));
    archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-api-archive-"));
    process.env.THREADKEEP_DATA_DIR = dataDir;
    process.env.THREADKEEP_ALLOW_PATH = "1";
    process.env.THREADKEEP_SKIP_BUILD = "1";
    closeDb();
    writeZip(path.join(archiveDir, "WhatsApp Chat with Alice.zip"), {
      "WhatsApp Chat with Alice.txt":
        "15/09/26, 10:32 am - Alice: the flight booking is confirmed\n15/09/26, 10:33 am - Bob: IMG-20260915-WA0001.jpg (file attached)",
      "IMG-20260915-WA0001.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    app = await createApp();
  });

  afterEach(() => {
    closeDb();
    if (previousData) process.env.THREADKEEP_DATA_DIR = previousData;
    else delete process.env.THREADKEEP_DATA_DIR;
    if (previousAllow) process.env.THREADKEEP_ALLOW_PATH = previousAllow;
    else delete process.env.THREADKEEP_ALLOW_PATH;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(archiveDir, { recursive: true, force: true });
  });

  async function importFolder(dir: string) {
    const select = await request(app).post("/api/select-folder").send({ path: dir });
    expect(select.status).toBe(200);
    const started = await request(app).post("/api/import").send({ path: dir });
    expect(started.status).toBe(200);
    const status = await request(app).get("/api/status");
    return status.body;
  }

  it("accepts a pasted folder path without a system picker", async () => {
    delete process.env.THREADKEEP_ALLOW_PATH;
    const select = await request(app).post("/api/select-folder").send({ path: archiveDir });
    expect(select.status).toBe(200);
    expect(select.body.archivePath).toBe(archiveDir);
  });

  it("selects an archive folder and indexes chats", async () => {
    const status = await importFolder(archiveDir);
    expect(status.folder).toBe("ready");
    const chats = await request(app).get("/api/chats");
    expect(chats.body.chats[0].name).toBe("Alice");
  });

  it("reopens an existing archive without asking for a folder", async () => {
    await importFolder(archiveDir);
    closeDb();
    const again = await createApp();
    const status = await request(again).get("/api/status");
    expect(status.body.archivePath).toBe(archiveDir);
    expect(status.body.folder).toBe("ready");
  });

  it("reports a missing archive folder", async () => {
    await importFolder(archiveDir);
    fs.rmSync(archiveDir, { recursive: true, force: true });
    const status = await request(app).get("/api/status");
    expect(status.body.folder).toBe("missing");
  });

  it("indexes new zips incrementally", async () => {
    await importFolder(archiveDir);
    writeZip(path.join(archiveDir, "WhatsApp Chat with Zara.zip"), {
      "WhatsApp Chat with Zara.txt": "15/09/26, 10:32 am - Zara: new chat",
    });
    const status = await importFolder(archiveDir);
    expect(status.import.report.imported + status.import.report.reused).toBeGreaterThanOrEqual(2);
    const chats = await request(app).get("/api/chats");
    expect(chats.body.chats.some((chat: { name: string }) => chat.name === "Zara")).toBe(true);
  });

  it("opens a chat and jumps from search to a message", async () => {
    await importFolder(archiveDir);
    const chats = await request(app).get("/api/chats");
    const chatId = chats.body.chats[0].id;
    const messages = await request(app).get(`/api/chats/${chatId}/messages?offset=0&limit=20`);
    expect(messages.body.messages.length).toBeGreaterThan(0);
    const search = await request(app).get("/api/search?q=flight%20booking");
    expect(search.body.results[0].chatId).toBe(chatId);
    const index = await request(app).get(
      `/api/chats/${chatId}/messages/${search.body.results[0].messageId}/index`,
    );
    expect(index.body.seq).toBe(search.body.results[0].seq);
  });

  it("extracts media only when requested", async () => {
    await importFolder(archiveDir);
    const chat = listChats()[0];
    const message = getMessages(chat.id, 0, 20).find((row) => row.attachment && !row.attachment.omitted);
    expect(message?.attachment).toBeTruthy();
    const cacheDir = path.join(dataDir, "cache", "media");
    expect(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).length : 0).toBe(0);
    const file = await materializeAttachment(message!.attachment!.id);
    expect(fs.existsSync(file.filePath)).toBe(true);
    const media = await request(app).get(`/api/media/${message!.attachment!.id}`);
    expect(media.status).toBe(200);
  });
});
