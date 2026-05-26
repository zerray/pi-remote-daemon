import { describe, expect, it } from "vitest";
import { createTranscriptEventCanonicalizer } from "../src/extension/transcript-event-canonicalizer.js";

function ctx(entries: unknown[]) {
  return { sessionManager: { getEntries: () => entries } };
}

describe("transcript event canonicalizer", () => {
  it("drains id-less message events by role and message timestamp", () => {
    const entries: unknown[] = [];
    const canonicalizer = createTranscriptEventCanonicalizer();

    expect(canonicalizer.canonicalize({
      type: "message_end",
      message: { role: "user", timestamp: 1779774200513, content: [{ type: "text", text: "你好" }] },
    }, ctx(entries))).toEqual([]);
    expect(canonicalizer.hasPending()).toBe(true);

    entries.push({
      type: "message",
      id: "14eb1111",
      timestamp: "2026-05-26T05:43:20.516Z",
      message: { role: "user", timestamp: 1779774200513, content: [{ type: "text", text: "你好" }] },
    });

    expect(canonicalizer.drain(ctx(entries))).toEqual([{
      type: "message_end",
      id: "14eb1111",
      timestamp: "2026-05-26T05:43:20.516Z",
      message: { id: "14eb1111", role: "user", timestamp: 1779774200513, content: [{ type: "text", text: "你好" }] },
    }]);
    expect(canonicalizer.hasPending()).toBe(false);
  });

  it("does not match id-less events by content when message timestamps are absent", () => {
    const canonicalizer = createTranscriptEventCanonicalizer();
    const entries = [{
      type: "message",
      id: "entry_1",
      timestamp: "2026-05-09T00:00:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "same content" }] },
    }];

    expect(canonicalizer.canonicalize({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "same content" }] },
    }, ctx(entries))).toEqual([]);
    expect(canonicalizer.hasPending()).toBe(false);
  });

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

  it("drains pending temporary message events after the session entry appears", () => {
    const entries: unknown[] = [];
    const canonicalizer = createTranscriptEventCanonicalizer();

    expect(canonicalizer.canonicalize({
      type: "message_end",
      id: "tmp_user_1",
      timestamp: 1778284800000,
      message: { id: "tmp_user_1", role: "user", timestamp: 1778284800000, content: "sent from iOS" },
    }, ctx(entries))).toEqual([]);
    expect(canonicalizer.hasPending()).toBe(true);

    entries.push({
      type: "message",
      id: "entry_user_1",
      timestamp: "2026-05-09T00:00:00.000Z",
      message: { role: "user", timestamp: 1778284800000, content: "sent from iOS" },
    });

    expect(canonicalizer.drain(ctx(entries))).toEqual([{
      type: "message_end",
      id: "entry_user_1",
      timestamp: "2026-05-09T00:00:00.000Z",
      message: { id: "entry_user_1", role: "user", timestamp: 1778284800000, content: "sent from iOS" },
    }]);
    expect(canonicalizer.hasPending()).toBe(false);
  });

  it("evicts pending temporary message events after bounded retry attempts", () => {
    const canonicalizer = createTranscriptEventCanonicalizer({ maxDrainAttempts: 1 });

    expect(canonicalizer.canonicalize({
      type: "message_end",
      id: "tmp_1",
      message: { id: "tmp_1", role: "assistant", content: [{ type: "text", text: "never persisted" }] },
    }, ctx([]))).toEqual([]);

    expect(canonicalizer.drain(ctx([]))).toEqual([]);
    expect(canonicalizer.hasPending()).toBe(false);
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
