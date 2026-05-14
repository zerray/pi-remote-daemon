import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionTranscriptMessages, visibleConversationMessageCount } from "../src/session-transcript.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pi-remote-control-transcript-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("session transcript files", () => {
  it("reads message entries from Pi JSONL session files", async () => {
    const sessionFile = join(root, "session.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "user", content: "hello" } }),
      JSON.stringify({ type: "tool_execution_start", toolCallId: "call_1" }),
      JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
      "not-json",
      "",
    ].join("\n"));

    expect(readSessionTranscriptMessages(sessionFile)).toEqual([
      { id: "msg_1", role: "user", content: [{ type: "text", text: "hello" }], text: "hello", createdAt: "2026-05-09T00:00:01.000Z", isStreaming: false },
      { id: "msg_2", role: "assistant", content: [{ type: "text", text: "hi" }], text: "hi", createdAt: "2026-05-09T00:00:02.000Z", isStreaming: false },
    ]);
  });

  it("preserves thinking, tool calls, and tool result metadata", async () => {
    const sessionFile = join(root, "structured-session.jsonl");
    await writeFile(sessionFile, [
      JSON.stringify({ type: "message", id: "msg_1", timestamp: "2026-05-09T00:00:01.000Z", message: { role: "assistant", content: [
        { type: "thinking", thinking: "checking" },
        { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } },
        { type: "text", text: "done" },
      ] } }),
      JSON.stringify({ type: "message", id: "msg_2", timestamp: "2026-05-09T00:00:02.000Z", message: { role: "toolResult", toolCallId: "call_1", toolName: "bash", isError: false, content: [{ type: "text", text: "file.txt" }] } }),
    ].join("\n"));

    expect(readSessionTranscriptMessages(sessionFile)).toEqual([
      {
        id: "msg_1",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "checking" },
          { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } },
          { type: "text", text: "done" },
        ],
        text: "done",
        createdAt: "2026-05-09T00:00:01.000Z",
        isStreaming: false,
      },
      {
        id: "msg_2",
        role: "toolResult",
        content: [{ type: "text", text: "file.txt" }],
        text: "file.txt",
        createdAt: "2026-05-09T00:00:02.000Z",
        toolCallId: "call_1",
        toolName: "bash",
        isError: false,
        isStreaming: false,
      },
    ]);
  });

  it("counts only visible user and assistant conversation messages", () => {
    expect(visibleConversationMessageCount([
      { id: "msg_1", role: "user", content: [{ type: "text", text: "hello" }], text: "hello", createdAt: "2026-05-09T00:00:01.000Z", isStreaming: false },
      { id: "msg_2", role: "assistant", content: [{ type: "thinking", thinking: "checking" }, { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "ls" } }, { type: "text", text: "done" }], text: "done", createdAt: "2026-05-09T00:00:02.000Z", isStreaming: false },
      { id: "msg_3", role: "toolResult", content: [{ type: "text", text: "file.txt" }], text: "file.txt", createdAt: "2026-05-09T00:00:03.000Z", isStreaming: false },
      { id: "msg_4", role: "system", content: [{ type: "text", text: "system" }], text: "system", createdAt: "2026-05-09T00:00:04.000Z", isStreaming: false },
    ])).toBe(2);
  });

  it("returns an empty transcript when the session file is missing", () => {
    expect(readSessionTranscriptMessages(join(root, "missing.jsonl"))).toEqual([]);
  });
});
