import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import yauzl from "yauzl";
import type { ZipEntryInfo } from "./types.js";

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) {
        reject(error || new Error("Unable to open ZIP"));
        return;
      }
      resolve(zip);
    });
  });
}

export async function listZipEntries(filePath: string): Promise<ZipEntryInfo[]> {
  const zip = await openZip(filePath);
  return new Promise((resolve, reject) => {
    const entries: ZipEntryInfo[] = [];
    zip.on("error", (error) => {
      zip.close();
      reject(error);
    });
    zip.on("end", () => {
      zip.close();
      resolve(entries);
    });
    zip.on("entry", (entry) => {
      if (!/\/$/.test(entry.fileName)) {
        entries.push({
          fileName: entry.fileName.replace(/\\/g, "/"),
          uncompressedSize: entry.uncompressedSize,
        });
      }
      zip.readEntry();
    });
    zip.readEntry();
  });
}

export async function readZipEntry(filePath: string, entryName: string): Promise<Buffer> {
  const zip = await openZip(filePath);
  const wanted = entryName.replace(/\\/g, "/");
  const wantedBase = path.posix.basename(wanted).toLowerCase();

  return new Promise((resolve, reject) => {
    let found = false;
    zip.on("error", (error) => {
      zip.close();
      reject(error);
    });
    zip.on("end", () => {
      zip.close();
      if (!found) reject(new Error(`File not found in ZIP: ${entryName}`));
    });
    zip.on("entry", (entry) => {
      const name = entry.fileName.replace(/\\/g, "/");
      const match =
        name === wanted ||
        name.endsWith(`/${wanted}`) ||
        path.posix.basename(name).toLowerCase() === wantedBase;
      if (!match || /\/$/.test(entry.fileName)) {
        zip.readEntry();
        return;
      }
      found = true;
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          zip.close();
          reject(error || new Error("Unable to read ZIP entry"));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(chunk as Buffer));
        stream.on("error", (streamError) => {
          zip.close();
          reject(streamError);
        });
        stream.on("end", () => {
          zip.close();
          resolve(Buffer.concat(chunks));
        });
      });
    });
    zip.readEntry();
  });
}

export async function streamZipEntry(
  filePath: string,
  entryName: string,
  destination: string,
): Promise<{ size: number; hash: string }> {
  const zip = await openZip(filePath);
  const wanted = entryName.replace(/\\/g, "/");
  const wantedBase = path.posix.basename(wanted).toLowerCase();

  return new Promise((resolve, reject) => {
    let found = false;
    zip.on("error", (error) => {
      zip.close();
      reject(error);
    });
    zip.on("end", () => {
      zip.close();
      if (!found) reject(new Error(`File not found in ZIP: ${entryName}`));
    });
    zip.on("entry", (entry) => {
      const name = entry.fileName.replace(/\\/g, "/");
      const match =
        name === wanted ||
        name.endsWith(`/${wanted}`) ||
        path.posix.basename(name).toLowerCase() === wantedBase;
      if (!match || /\/$/.test(entry.fileName)) {
        zip.readEntry();
        return;
      }
      found = true;
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          zip.close();
          reject(error || new Error("Unable to read ZIP entry"));
          return;
        }
        const hash = createHash("sha256");
        let size = 0;
        const out = fs.createWriteStream(destination);
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          hash.update(chunk);
        });
        stream.pipe(out);
        stream.on("error", (streamError) => {
          zip.close();
          out.destroy();
          reject(streamError);
        });
        out.on("error", (outError) => {
          zip.close();
          reject(outError);
        });
        out.on("finish", () => {
          zip.close();
          resolve({ size, hash: hash.digest("hex") });
        });
      });
    });
    zip.readEntry();
  });
}
