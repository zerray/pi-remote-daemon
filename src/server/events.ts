import { NotImplementedError } from "../errors.js";
import type { ToolCallStatus, ToolCallStatusValue } from "../types.js";

export type AssistantDeltaEvent = {
  type: "assistant_delta";
  messageId: string;
  text: string;
};

export type ToolStatusEvent = {
  type: "tool_status";
  tool: ToolCallStatus;
};

export type ClientStreamEvent = AssistantDeltaEvent | ToolStatusEvent | { type: "agent_done" } | { type: "error"; message: string };

export type PiToolExecutionEvent = {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  isError?: boolean;
};

export function summarizeToolArgs(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;

  if (toolName === "bash" && typeof record.command === "string") return record.command;
  if (["read", "write", "edit", "grep", "find", "ls"].includes(toolName) && typeof record.path === "string") {
    return record.path;
  }

  return undefined;
}

export function toolStatusFromPiEvent(event: PiToolExecutionEvent, now: Date): ToolCallStatus {
  return {
    id: event.toolCallId,
    name: event.toolName,
    status: statusFromPiToolEvent(event),
    summary: summarizeToolArgs(event.toolName, event.args),
    updatedAt: now.toISOString(),
  };
}

export function statusFromPiToolEvent(event: PiToolExecutionEvent): ToolCallStatusValue {
  if (event.type === "tool_execution_end") return event.isError ? "failed" : "succeeded";
  return "running";
}
