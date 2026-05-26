import { describe, expect, it } from "vitest";
import { createTranscriptEventCanonicalizer } from "../src/extension/transcript-event-canonicalizer.js";

function ctx(entries: unknown[]) {
  return { sessionManager: { getEntries: () => entries } };
}

describe("transcript event canonicalizer", () => {
  it("uses an existing session entry id even when streaming content is partial", () => {
    const canonicalizer = createTranscriptEventCanonicalizer();
    const entries = [{
      type: "message",
      id: "entry_1",
      timestamp: "2026-05-09T00:00:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "hello world" }] },
    }];

    expect(canonicalizer.canonicalize({
      type: "message_update",
      id: "entry_1",
      timestamp: 1778284800000,
      message: { id: "entry_1", role: "assistant", content: [{ type: "text", text: "hello" }] },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" },
    }, ctx(entries))).toEqual([{
      type: "message_update",
      id: "entry_1",
      timestamp: "2026-05-09T00:00:00.000Z",
      message: { id: "entry_1", role: "assistant", content: [{ type: "text", text: "hello" }] },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" },
    }]);
  });

  it("buffers temporary message events until a session entry id is available", () => {
    const entries: unknown[] = [];
    const canonicalizer = createTranscriptEventCanonicalizer();

    expect(canonicalizer.canonicalize({
      type: "message_start",
      id: "tmp_1",
      timestamp: 1778284800000,
      message: { id: "tmp_1", role: "assistant", timestamp: 1778284800000, content: [{ type: "text", text: "hello" }] },
    }, ctx(entries))).toEqual([]);

    entries.push({
      type: "message",
      id: "entry_1",
      timestamp: "2026-05-09T00:00:00.000Z",
      message: { role: "assistant", timestamp: 1778284800000, content: [{ type: "text", text: "hello" }] },
    });

    expect(canonicalizer.canonicalize({
      type: "message_end",
      id: "tmp_1",
      timestamp: 1778284800000,
      message: { id: "tmp_1", role: "assistant", timestamp: 1778284800000, content: [{ type: "text", text: "hello" }] },
    }, ctx(entries))).toEqual([
      {
        type: "message_start",
        id: "entry_1",
        timestamp: "2026-05-09T00:00:00.000Z",
        message: { id: "entry_1", role: "assistant", timestamp: 1778284800000, content: [{ type: "text", text: "hello" }] },
      },
      {
        type: "message_end",
        id: "entry_1",
        timestamp: "2026-05-09T00:00:00.000Z",
        message: { id: "entry_1", role: "assistant", timestamp: 1778284800000, content: [{ type: "text", text: "hello" }] },
      },
    ]);
  });
});
