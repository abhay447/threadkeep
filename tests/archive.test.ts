import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getChat, getMessages, listChats, searchMessages } from "../server/db.js";
import { discoverZipFiles, importArchive } from "../server/importer.js";

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeZip(filePath: string, files: Record<string, string | Uint8Array>) {
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    encoded[name] = typeof value === "string" ? strToU8(value) : value;
  }
  fs.writeFileSync(filePath, zipSync(encoded));
}

const previousDataDir = process.env.THREADKEEP_DATA_DIR;

describe("archive import", () => {
  let dataDir: string;
  let archiveDir: string;

  beforeEach(() => {
    dataDir = tempDir("tk-data-");
    archiveDir = tempDir("tk-archive-");
    process.env.THREADKEEP_DATA_DIR = dataDir;
    closeDb();
  });

  afterEach(() => {
    closeDb();
    if (previousDataDir) process.env.THREADKEEP_DATA_DIR = previousDataDir;
    else delete process.env.THREADKEEP_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(archiveDir, { recursive: true, force: true });
  });

  it("imports a ZIP that contains a chat transcript", async () => {
    writeZip(path.join(archiveDir, "WhatsApp Chat with Alice.zip"), {
      "WhatsApp Chat with Alice.txt": "15/09/26, 10:32 am - Alice: Hello\n15/09/26, 10:33 am - Bob: Hi",
    });
    const report = await importArchive(archiveDir);
    expect(report.imported).toBe(1);
    const chats = listChats();
    expect(chats[0].name).toBe("Alice");
    expect(getMessages(chats[0].id, 0, 20)).toHaveLength(2);
  });

  it("imports media metadata without extracting files", async () => {
    writeZip(path.join(archiveDir, "WhatsApp Chat with Bob.zip"), {
      "WhatsApp Chat with Bob.txt": "15/09/26, 10:32 am - Bob: IMG-20260915-WA0001.jpg (file attached)\nNice photo",
      "IMG-20260915-WA0001.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    await importArchive(archiveDir);
    const chats = listChats();
    const messages = getMessages(chats[0].id, 0, 10);
    expect(messages[0].type).toBe("image");
    expect(messages[0].attachment?.filename).toBe("IMG-20260915-WA0001.jpg");
    expect(messages[0].attachment?.omitted).toBe(false);
    const cache = path.join(dataDir, "cache", "media");
    expect(fs.existsSync(cache) ? fs.readdirSync(cache).length : 0).toBe(0);
  });

  it("links ZIP photos to blank caption lines", async () => {
    writeZip(path.join(archiveDir, "WhatsApp Chat with Eden.zip"), {
      "WhatsApp Chat with Eden.txt": "18/08/25, 3:37 pm - Eden:\n18/08/25, 3:38 pm - Eden: caption",
      "IMG-20250818-WA0020.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    await importArchive(archiveDir);
    const messages = getMessages(listChats()[0].id, 0, 10);
    expect(messages[0].type).toBe("image");
    expect(messages[0].attachment?.filename).toBe("IMG-20250818-WA0020.jpg");
    expect(messages[1].text).toBe("caption");
  });

  it("imports chats exported without media", async () => {
    writeZip(path.join(archiveDir, "WhatsApp Chat with Cara.zip"), {
      "WhatsApp Chat with Cara.txt": "15/09/26, 10:32 am - Cara: <Media omitted>\n15/09/26, 10:33 am - Cara: text only",
    });
    await importArchive(archiveDir);
    const messages = getMessages(listChats()[0].id, 0, 10);
    expect(messages[0].attachment?.omitted).toBe(true);
    expect(messages[1].text).toBe("text only");
  });

  it("skips malformed ZIPs and continues", async () => {
    fs.writeFileSync(path.join(archiveDir, "broken.zip"), "this is not a zip");
    writeZip(path.join(archiveDir, "WhatsApp Chat with Dana.zip"), {
      "WhatsApp Chat with Dana.txt": "15/09/26, 10:32 am - Dana: Hello",
    });
    const report = await importArchive(archiveDir);
    expect(report.found).toBe(2);
    expect(report.imported).toBe(1);
    expect(report.errors + report.skipped).toBeGreaterThan(0);
    expect(listChats()).toHaveLength(1);
  });

  it("detects duplicate ZIPs by content hash", async () => {
    const txt = "15/09/26, 10:32 am - Eve: Hello";
    writeZip(path.join(archiveDir, "WhatsApp Chat with Eve.zip"), { "WhatsApp Chat with Eve.txt": txt });
    writeZip(path.join(archiveDir, "WhatsApp Chat with Eve (1).zip"), { "WhatsApp Chat with Eve.txt": txt });
    const report = await importArchive(archiveDir);
    expect(report.imported).toBe(1);
    expect(report.duplicates).toBe(1);
    expect(listChats()).toHaveLength(1);
  });

  it("handles unicode ZIP filenames", async () => {
    writeZip(path.join(archiveDir, "WhatsApp Chat with प्रिया.zip"), {
      "WhatsApp Chat with प्रिया.txt": "15/09/26, 10:32 am - प्रिया: नमस्ते 🙏",
    });
    await importArchive(archiveDir);
    expect(listChats()[0].name).toBe("प्रिया");
  });

  it("discovers zips recursively and reuses unchanged files", async () => {
    const nested = path.join(archiveDir, "nested");
    fs.mkdirSync(nested);
    writeZip(path.join(nested, "WhatsApp Chat with Nested.zip"), {
      "WhatsApp Chat with Nested.txt": "15/09/26, 10:32 am - Nested: Hello",
    });
    expect(discoverZipFiles(archiveDir)).toHaveLength(1);
    const first = await importArchive(archiveDir);
    expect(first.imported).toBe(1);
    const second = await importArchive(archiveDir);
    expect(second.reused).toBe(1);
    expect(second.imported).toBe(0);
  });
});

describe("search", () => {
  let dataDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    dataDir = tempDir("tk-search-");
    archiveDir = tempDir("tk-search-archive-");
    process.env.THREADKEEP_DATA_DIR = dataDir;
    closeDb();
    writeZip(path.join(archiveDir, "WhatsApp Chat with Alice.zip"), {
      "WhatsApp Chat with Alice.txt": [
        "15/09/26, 10:32 am - Alice: the flight booking is confirmed",
        "16/09/26, 11:00 am - Bob: dinner plans 🍕",
        "17/09/26, 12:00 pm - Alice: नमस्ते friends",
      ].join("\n"),
    });
    writeZip(path.join(archiveDir, "WhatsApp Chat with Family.zip"), {
      "WhatsApp Chat with Family.txt": "15/09/26, 10:32 am - Mom: wedding venue locked\n15/09/26, 10:33 am - You created this group",
    });
    await importArchive(archiveDir);
  });

  afterEach(() => {
    closeDb();
    if (previousDataDir) process.env.THREADKEEP_DATA_DIR = previousDataDir;
    else delete process.env.THREADKEEP_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(archiveDir, { recursive: true, force: true });
  });

  it("searches globally", () => {
    const hits = searchMessages({ q: "flight booking" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chatName).toBe("Alice");
    expect(hits[0].snippet.toLowerCase()).toContain("flight");
  });

  it("searches inside one chat", () => {
    const chat = listChats().find((row) => row.name === "Alice")!;
    const hits = searchMessages({ q: "dinner", chatId: chat.id });
    expect(hits).toHaveLength(1);
    expect(hits[0].seq).toBe(1);
  });

  it("supports unicode and emoji", () => {
    expect(searchMessages({ q: "नमस्ते" }).length).toBeGreaterThan(0);
    expect(searchMessages({ q: "🍕" }).length).toBeGreaterThan(0);
  });

  it("supports partial matches and navigation metadata", () => {
    const hits = searchMessages({ q: "book" });
    expect(hits[0].messageId).toBeGreaterThan(0);
    expect(hits[0].seq).toBeGreaterThanOrEqual(0);
    const chat = getChat(hits[0].chatId);
    expect(chat?.name).toBe("Alice");
  });
});
