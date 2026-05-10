import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionTranscriptMessages } from "../src/session-transcript.js";

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
      { id: "msg_1", role: "user", text: "hello", createdAt: "2026-05-09T00:00:01.000Z", isStreaming: false },
      { id: "msg_2", role: "assistant", text: "hi", createdAt: "2026-05-09T00:00:02.000Z", isStreaming: false },
    ]);
  });

  it("returns an empty transcript when the session file is missing", () => {
    expect(readSessionTranscriptMessages(join(root, "missing.jsonl"))).toEqual([]);
  });
});
