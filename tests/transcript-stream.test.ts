import { describe, expect, it } from "vitest";
import { normalizeTuiEvent } from "../src/transcript-stream.js";

describe("TUI event transcript stream normalization", () => {
  it("normalizes message lifecycle events to transcript message events", () => {
    expect(normalizeTuiEvent({
      type: "message_start",
      message: { id: "msg_1", role: "assistant", timestamp: 1778284801000, content: [] },
    })).toEqual([{
      type: "transcript_message_start",
      message: {
        id: "msg_1",
        role: "assistant",
        content: [],
        text: "",
        createdAt: "2026-05-09T00:00:01.000Z",
        isStreaming: true,
      },
    }]);

    expect(normalizeTuiEvent({
      type: "message_end",
      message: { id: "msg_1", role: "assistant", timestamp: 1778284802000, content: [{ type: "text", text: "done" }] },
    })).toEqual([{
      type: "transcript_message_end",
      message: {
        id: "msg_1",
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        text: "done",
        createdAt: "2026-05-09T00:00:02.000Z",
        isStreaming: false,
      },
    }]);
  });

  it("normalizes assistant message deltas to transcript message patches", () => {
    expect(normalizeTuiEvent({
      type: "message_update",
      message: { id: "msg_1", role: "assistant" },
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "checking" },
    })).toEqual([{ type: "transcript_message_patch", messageId: "msg_1", contentIndex: 0, patch: { type: "thinking_delta", delta: "checking" } }]);

    expect(normalizeTuiEvent({
      type: "message_update",
      message: { id: "msg_1", role: "assistant" },
      assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "hello" },
    })).toEqual([{ type: "transcript_message_patch", messageId: "msg_1", contentIndex: 1, patch: { type: "text_delta", delta: "hello" } }]);

    expect(normalizeTuiEvent({
      type: "message_update",
      message: { id: "msg_1", role: "assistant" },
      assistantMessageEvent: { type: "toolcall_end", contentIndex: 2, toolCall: { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } } },
    })).toEqual([{ type: "transcript_message_patch", messageId: "msg_1", contentIndex: 2, patch: { type: "toolCall", toolCall: { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } } } }]);
  });

  it("normalizes tool execution events", () => {
    expect(normalizeTuiEvent({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "ls" } })).toEqual([
      { type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "ls" } },
    ]);
    expect(normalizeTuiEvent({ type: "tool_execution_update", toolCallId: "call_1", toolName: "bash", partialResult: { content: [] } })).toEqual([
      { type: "tool_execution_update", toolCallId: "call_1", toolName: "bash", partialResult: { content: [] } },
    ]);
    expect(normalizeTuiEvent({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { content: [] }, isError: false })).toEqual([
      { type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { content: [] }, isError: false },
    ]);
  });

  it("ignores events without public stream representation", () => {
    expect(normalizeTuiEvent({ type: "agent_start" })).toEqual([]);
  });
});
