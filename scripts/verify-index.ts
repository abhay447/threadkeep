import { getMessages, listChats, searchMessages, stats } from "../server/db.js";
import { materializeAttachment } from "../server/media.js";

const s = stats();
const chats = listChats();
process.stdout.write(`stats ${JSON.stringify(s)}\n`);
process.stdout.write(
  `top ${JSON.stringify(chats.slice(0, 5).map((c) => ({ name: c.name, n: c.messageCount, group: c.isGroup, media: c.mediaCount })))}\n`,
);
process.stdout.write(`groups ${JSON.stringify(chats.filter((c) => c.isGroup).map((c) => c.name))}\n`);
const hits = searchMessages({ q: "flight" });
process.stdout.write(
  `search ${hits.length} ${hits[0] ? JSON.stringify({ chat: hits[0].chatName, seq: hits[0].seq }) : "none"}\n`,
);
const withMedia = chats.find((c) => c.imageCount > 0) || chats[0];
let found = null as ReturnType<typeof getMessages>[number] | null;
for (let offset = 0; offset < Math.min(withMedia.messageCount, 2000); offset += 200) {
  const batch = getMessages(withMedia.id, offset, 200);
  found = batch.find((m) => m.attachment && !m.attachment.omitted && (m.type === "image" || m.type === "video" || m.type === "document")) || null;
  if (found) break;
}
if (found?.attachment) {
  const file = await materializeAttachment(found.attachment.id);
  process.stdout.write(`extracted ${JSON.stringify({ mime: file.mimeType, size: file.size, name: file.filename })}\n`);
} else {
  process.stdout.write("no image found in sample\n");
}
