import { describe, expect, it } from "vitest";
import { statusFromPiToolEvent, summarizeToolArgs, toolStatusFromPiEvent } from "../src/server/events.js";

describe("stream event normalization", () => {
  it("summarizes common tool arguments", () => {
    expect(summarizeToolArgs("bash", { command: "npm test" })).toBe("npm test");
    expect(summarizeToolArgs("read", { path: "README.md" })).toBe("README.md");
    expect(summarizeToolArgs("unknown", { value: 1 })).toBeUndefined();
  });

  it("maps Pi tool event status", () => {
    expect(statusFromPiToolEvent({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash" })).toBe("running");
    expect(statusFromPiToolEvent({ type: "tool_execution_update", toolCallId: "call_1", toolName: "bash" })).toBe("running");
    expect(statusFromPiToolEvent({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", isError: false })).toBe("succeeded");
    expect(statusFromPiToolEvent({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", isError: true })).toBe("failed");
  });

  it("normalizes Pi tool events into app tool statuses", () => {
    expect(
      toolStatusFromPiEvent(
        { type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "npm test" } },
        new Date("2026-05-09T00:00:00.000Z"),
      ),
    ).toEqual({
      id: "call_1",
      name: "bash",
      status: "running",
      summary: "npm test",
      updatedAt: "2026-05-09T00:00:00.000Z",
    });
  });
});
