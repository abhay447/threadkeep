import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { mediaCacheDir } from "./config.js";
import { getAttachment } from "./db.js";
import { streamZipEntry } from "./zip.js";

const cacheIndex = new Map<number, string>();

function cacheKey(zipPath: string, internalPath: string, filename: string): string {
  return createHash("sha256").update(`${zipPath}|${internalPath}|${filename}`).digest("hex");
}

export async function materializeAttachment(attachmentId: number): Promise<{
  filePath: string;
  mimeType: string;
  filename: string;
  size: number;
}> {
  const attachment = getAttachment(attachmentId);
  if (!attachment) throw new Error("Attachment not found");
  if (attachment.omitted) throw new Error("Media was not included in this export");

  const cached = cacheIndex.get(attachmentId);
  if (cached && fs.existsSync(cached)) {
    const stat = fs.statSync(cached);
    return {
      filePath: cached,
      mimeType: attachment.mime_type || "application/octet-stream",
      filename: attachment.filename,
      size: stat.size,
    };
  }

  const ext = path.extname(attachment.filename || attachment.internal_path) || "";
  const key = cacheKey(attachment.zip_path, attachment.internal_path, attachment.filename);
  const dest = path.join(mediaCacheDir(), `${key}${ext}`);

  if (!fs.existsSync(dest)) {
    if (!fs.existsSync(attachment.zip_path)) {
      throw new Error("The original ZIP file is no longer available");
    }
    await streamZipEntry(attachment.zip_path, attachment.internal_path || attachment.filename, dest);
  }

  cacheIndex.set(attachmentId, dest);
  const stat = fs.statSync(dest);
  return {
    filePath: dest,
    mimeType: attachment.mime_type || "application/octet-stream",
    filename: attachment.filename,
    size: stat.size,
  };
}
