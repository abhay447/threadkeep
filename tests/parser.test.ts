import { describe, expect, it } from "vitest";
import {
  chatNameFromFilename,
  inspectMessageBody,
  isGroupChat,
  looksLikeChatTranscript,
  matchTimestampLine,
  parseChatExport,
} from "../server/parser.js";

describe("timestamp detection", () => {
  it("parses Android 12-hour dates with narrow spaces", () => {
    const match = matchTimestampLine("01/09/23, 11:56\u202fpm - Alice: Hello");
    expect(match).not.toBeNull();
    expect(match?.date.getFullYear()).toBe(2023);
    expect(match?.date.getMonth()).toBe(8);
    expect(match?.date.getDate()).toBe(1);
    expect(match?.date.getHours()).toBe(23);
    expect(match?.rest).toBe("Alice: Hello");
  });

  it("parses 24-hour Android dates", () => {
    const match = matchTimestampLine("15/09/26, 10:32 - Alice: Hello");
    expect(match?.date.getHours()).toBe(10);
    expect(match?.date.getMinutes()).toBe(32);
  });

  it("parses iOS bracket timestamps", () => {
    const match = matchTimestampLine("[15/09/26, 10:32:11] Alice: Hello");
    expect(match?.date.getSeconds()).toBe(11);
    expect(match?.rest).toBe("Alice: Hello");
  });

  it("parses US-style dates when the day is unambiguous", () => {
    const match = matchTimestampLine("12/22/24, 3:14 pm - Bob: Hi");
    expect(match?.date.getDate()).toBe(22);
    expect(match?.date.getMonth()).toBe(11);
  });

  it("does not treat continuation lines as messages", () => {
    expect(matchTimestampLine("1. Notice for both parties should be the same")).toBeNull();
    expect(matchTimestampLine("https://example.com/path")).toBeNull();
  });
});

describe("parseChatExport", () => {
  it("parses normal messages", () => {
    const { messages } = parseChatExport(
      "15/09/26, 10:32 am - Alice: Hello\n15/09/26, 10:33 am - Bob: Hi there",
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].sender).toBe("Alice");
    expect(messages[0].text).toBe("Hello");
    expect(messages[1].sender).toBe("Bob");
  });

  it("joins continuation lines into multiline messages", () => {
    const { messages } = parseChatExport(
      "15/09/26, 10:32 am - Alice: Line one\nLine two\nLine three\n15/09/26, 10:33 am - Bob: Next",
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe("Line one\nLine two\nLine three");
    expect(messages[1].text).toBe("Next");
  });

  it("keeps emoji and URLs", () => {
    const { messages } = parseChatExport(
      "15/09/26, 10:32 am - Alice: Hello 🎉\nhttps://example.com/book",
    );
    expect(messages[0].text).toContain("🎉");
    expect(messages[0].text).toContain("https://example.com/book");
  });

  it("parses group senders", () => {
    const { messages } = parseChatExport(
      [
        '15/09/26, 10:32 am - Neeraj created group "Family"',
        "15/09/26, 10:33 am - Neeraj: Welcome",
        "15/09/26, 10:34 am - Pinto: Hello",
        "15/09/26, 10:35 am - Alice: Hi",
      ].join("\n"),
    );
    expect(messages[0].isSystem).toBe(true);
    expect(messages[1].sender).toBe("Neeraj");
    expect(messages[2].sender).toBe("Pinto");
    expect(isGroupChat(messages, 3)).toBe(true);
  });

  it("detects system, deleted, and encryption notices", () => {
    const { messages } = parseChatExport(
      [
        "15/09/26, 10:32 am - Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share them. *Learn more*",
        "15/09/26, 10:33 am - Alice: You deleted this message",
        "15/09/26, 10:34 am - Bob: This message was deleted",
        "15/09/26, 10:35 am - You created this group",
      ].join("\n"),
    );
    expect(messages[0].isSystem).toBe(true);
    expect(messages[0].type).toBe("system");
    expect(messages[1].isDeleted).toBe(true);
    expect(messages[2].isDeleted).toBe(true);
    expect(messages[3].isSystem).toBe(true);
  });

  it("parses media placeholders and attachments", () => {
    const { messages } = parseChatExport(
      [
        "15/09/26, 10:32 am - Alice: IMG-20260915-WA0001.jpg (file attached)",
        "caption here",
        "15/09/26, 10:33 am - Alice: PTT-20260915-WA0002.opus (file attached)",
        "15/09/26, 10:34 am - Alice: <Media omitted>",
        "15/09/26, 10:35 am - Alice: location: https://maps.google.com/?q=12.9,77.6",
        "15/09/26, 10:36 am - Alice: 2 contacts.vcf (file attached)",
      ].join("\n"),
    );
    expect(messages[0].type).toBe("image");
    expect(messages[0].attachment?.filename).toBe("IMG-20260915-WA0001.jpg");
    expect(messages[0].text).toBe("caption here");
    expect(messages[1].type).toBe("audio");
    expect(messages[2].attachment?.omitted).toBe(true);
    expect(messages[3].type).toBe("location");
    expect(messages[4].type).toBe("contact");
  });

  it("handles unicode names and malformed lines", () => {
    const { messages, warnings } = parseChatExport(
      [
        "not a message yet",
        "15/09/26, 10:32 am - प्रिया दीदी: नमस्ते",
        "still going",
        "garbage without a stamp",
        "15/09/26, 10:33 am - Alice: Done",
      ].join("\n"),
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(messages[0].sender).toBe("प्रिया दीदी");
    expect(messages[0].text).toContain("नमस्ते");
    expect(messages[0].text).toContain("garbage without a stamp");
    expect(messages[1].text).toBe("Done");
  });

  it("keeps Odia text on the same message as the sender", () => {
    const { messages } = parseChatExport("10/08/25, 12:20 pm - Alice: sorry, ଯେତେବେଳେ");
    expect(messages[0].sender).toBe("Alice");
    expect(messages[0].isSystem).toBe(false);
    expect(messages[0].text).toContain("sorry");
  });

  it("parses empty-body messages that end with a colon", () => {
    const { messages } = parseChatExport("15/09/26, 10:32 am - Alice:\n15/09/26, 10:33 am - Bob: Hi");
    expect(messages[0].isSystem).toBe(false);
    expect(messages[0].sender).toBe("Alice");
    expect(messages[0].text).toBe("");
    expect(messages[1].sender).toBe("Bob");
  });

  it("does not treat user messages containing system-like phrases as system", () => {
    const { messages } = parseChatExport(
      "22/02/21, 3:08 pm - Alice: I have added you as a beneficiary and sent money",
    );
    expect(messages[0].isSystem).toBe(false);
    expect(messages[0].sender).toBe("Alice");
    expect(isGroupChat(messages, 1)).toBe(false);
  });

  it("marks edited messages", () => {
    const { messages } = parseChatExport("15/09/26, 10:32 am - Alice: Hello <This message was edited>");
    expect(messages[0].isEdited).toBe(true);
    expect(messages[0].text).toBe("Hello");
  });
});

describe("helpers", () => {
  it("derives chat names and transcript files", () => {
    expect(chatNameFromFilename("WhatsApp Chat with Alice.zip")).toBe("Alice");
    expect(chatNameFromFilename("WhatsApp Chat with Family Group (1).txt")).toBe("Family Group");
    expect(looksLikeChatTranscript("WhatsApp Chat with Alice.txt")).toBe(true);
    expect(looksLikeChatTranscript("notes.txt")).toBe(false);
  });

  it("classifies attachment bodies", () => {
    expect(inspectMessageBody("VID-20260915-WA0001.mp4 (file attached)").type).toBe("video");
    expect(inspectMessageBody("STK-20260915-WA0001.webp (file attached)").type).toBe("sticker");
    expect(inspectMessageBody("DOC-20260915-WA0001.pdf (file attached)").type).toBe("document");
  });
});

describe("orphan media", () => {
  it("attaches leftover ZIP photos to blank caption messages on the same day", async () => {
    const { attachOrphanMedia } = await import("../server/parser.js");
    const { messages } = parseChatExport(
      "18/08/25, 3:37 pm - Alice:\n18/08/25, 3:38 pm - Alice: hello\n06/09/25, 7:55 pm - Alice:\n",
    );
    const linked = attachOrphanMedia(messages, ["IMG-20250818-WA0020.jpg", "IMG-20250906-WA0005.jpg", "notes.txt"]);
    expect(linked).toBe(2);
    expect(messages[0].type).toBe("image");
    expect(messages[0].attachment?.filename).toBe("IMG-20250818-WA0020.jpg");
    expect(messages[1].text).toBe("hello");
    expect(messages[2].attachment?.filename).toBe("IMG-20250906-WA0005.jpg");
  });
});
