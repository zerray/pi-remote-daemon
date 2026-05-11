import { describe, expect, it } from "vitest";
import { INITIAL_WEBSOCKET_SESSION_MESSAGE_LIMIT, INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES, previewInitialSessionState } from "../src/transcript-preview.js";
import type { TranscriptMessage } from "../src/types.js";

function message(id: string, text = id): TranscriptMessage {
  return {
    id,
    role: "assistant",
    content: [{ type: "text", text }],
    text,
    createdAt: `2026-05-09T00:00:${id.padStart(2, "0")}.000Z`,
    isStreaming: false,
  };
}

describe("initial WebSocket session state preview", () => {
  it("keeps at most the newest 20 messages", () => {
    const state = { messages: Array.from({ length: 25 }, (_, index) => message(String(index + 1))) };

    expect(previewInitialSessionState(state).messages.map((item) => item.id)).toEqual(
      Array.from({ length: INITIAL_WEBSOCKET_SESSION_MESSAGE_LIMIT }, (_, index) => String(index + 6)),
    );
  });

  it("truncates oversized transcript message strings to the first 10 KiB", () => {
    const oversized = "a".repeat(INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES + 5);
    const state = { messages: [{ ...message("1", oversized), content: [{ type: "text", text: oversized }, { type: "thinking", thinking: oversized }] }] };

    expect(previewInitialSessionState(state).messages[0]).toEqual({
      id: "1",
      role: "assistant",
      content: [
        { type: "text", text: "a".repeat(INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES), truncated: true, originalBytes: INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES + 5 },
        { type: "thinking", thinking: "a".repeat(INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES), truncated: true, originalBytes: INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES + 5 },
      ],
      text: "a".repeat(INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES),
      textTruncated: true,
      textOriginalBytes: INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES + 5,
      createdAt: "2026-05-09T00:00:01.000Z",
      isStreaming: false,
    });
  });

  it("truncates oversized tool call argument strings and marks argument previews", () => {
    const oversized = "x".repeat(INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES + 1);
    const state = {
      messages: [{
        ...message("1", ""),
        content: [{ type: "toolCall", id: "call_1", name: "write", arguments: { path: "file.ts", content: oversized } }],
      }],
    };

    const result = previewInitialSessionState(state).messages[0]?.content[0];

    expect(result).toEqual({
      type: "toolCall",
      id: "call_1",
      name: "write",
      arguments: { path: "file.ts", content: "x".repeat(INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES) },
      argumentsTruncated: true,
      argumentsOriginalBytes: Buffer.byteLength(JSON.stringify({ path: "file.ts", content: oversized }), "utf8"),
    });
  });
});
