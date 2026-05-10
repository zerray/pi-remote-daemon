import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "../src/types.js";
import { decodeTranscriptCursor, encodeTranscriptCursor, olderTranscriptPage, recentTranscriptWindow } from "../src/transcript-pagination.js";

function message(id: string, createdAt: string): TranscriptMessage {
  return { id, role: "user", content: [{ type: "text", text: id }], text: id, createdAt, isStreaming: false };
}

describe("transcript pagination", () => {
  const messages = [
    message("msg_1", "2026-05-09T00:00:01.000Z"),
    message("msg_2", "2026-05-09T00:00:02.000Z"),
    message("msg_2", "2026-05-09T00:00:02.000Z"),
    message("msg_3", "2026-05-09T00:00:03.000Z"),
    message("msg_4", "2026-05-09T00:00:04.000Z"),
    message("msg_5", "2026-05-09T00:00:05.000Z"),
  ];

  it("returns a bounded recent window with a timestamp-only older cursor", () => {
    const page = recentTranscriptWindow(messages, 2);

    expect(page.messages.map((item) => item.id)).toEqual(["msg_4", "msg_5"]);
    expect(page.hasOlderMessages).toBe(true);
    expect(decodeTranscriptCursor(page.olderMessagesCursor ?? "")).toBe("2026-05-09T00:00:04.000Z");
  });

  it("returns older pages before an exclusive timestamp cursor", () => {
    const first = recentTranscriptWindow(messages, 2);
    const older = olderTranscriptPage(messages, first.olderMessagesCursor ?? "", 2);
    const oldest = olderTranscriptPage(messages, older.olderMessagesCursor ?? "", 2);

    expect(older.messages.map((item) => item.id)).toEqual(["msg_2", "msg_3"]);
    expect(older.hasOlderMessages).toBe(true);
    expect(decodeTranscriptCursor(older.olderMessagesCursor ?? "")).toBe("2026-05-09T00:00:02.000Z");
    expect(oldest.messages.map((item) => item.id)).toEqual(["msg_1"]);
    expect(oldest.hasOlderMessages).toBe(false);
    expect(oldest.olderMessagesCursor).toBeNull();
  });

  it("rejects malformed cursors", () => {
    expect(() => olderTranscriptPage(messages, "not-a-cursor", 2)).toThrow("invalid_cursor");
  });

  it("rejects timestamp cursors that do not match the transcript", () => {
    expect(() => olderTranscriptPage(messages, encodeTranscriptCursor("2026-05-09T00:00:30.000Z"), 2)).toThrow("invalid_cursor");
  });

  it("encodes cursors without message ids", () => {
    const cursor = encodeTranscriptCursor("2026-05-09T00:00:04.000Z");

    expect(decodeTranscriptCursor(cursor)).toBe("2026-05-09T00:00:04.000Z");
    expect(Buffer.from(cursor, "base64url").toString("utf8")).toBe("2026-05-09T00:00:04.000Z");
  });
});
