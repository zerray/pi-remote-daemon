import { describe, expect, it } from "vitest";
import { buildTreeSnapshot } from "../src/tree-snapshot.js";

describe("buildTreeSnapshot", () => {
  it("preserves tool names on tool-result entries", () => {
    const snapshot = buildTreeSnapshot({
      sessionId: "sess_1",
      leafId: "result_1",
      generatedAt: "2026-05-09T00:00:03.000Z",
      roots: [
        {
          entry: {
            type: "message",
            id: "result_1",
            parentId: null,
            timestamp: "2026-05-09T00:00:03.000Z",
            message: {
              role: "toolResult",
              toolCallId: "call_1",
              toolName: "bash",
              content: "swift test passed",
            },
          },
        },
      ],
    });

    expect(snapshot.entries[0]).toMatchObject({
      id: "result_1",
      role: "toolResult",
      toolName: "bash",
      title: "toolResult",
      preview: "swift test passed",
    });
  });
});
