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
  // For bash, show the command.
  // For file tools, show the path.
  // For unknown tools, return undefined to keep UI compact.
  void toolName;
  void args;
  throw new NotImplementedError("summarizeToolArgs");
}

export function toolStatusFromPiEvent(event: PiToolExecutionEvent, now: Date): ToolCallStatus {
  // Map Pi start/update/end events into running/succeeded/failed statuses.
  // Preserve toolCallId and toolName.
  // Include a compact argument summary when available.
  void event;
  void now;
  throw new NotImplementedError("toolStatusFromPiEvent");
}

export function statusFromPiToolEvent(event: PiToolExecutionEvent): ToolCallStatusValue {
  // Return running for start/update.
  // Return failed for end events with isError.
  // Return succeeded for successful end events.
  void event;
  throw new NotImplementedError("statusFromPiToolEvent");
}
