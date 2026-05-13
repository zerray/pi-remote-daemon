import { asRecord, readString, readTimestamp, transcriptMessageFromPiMessage } from "./transcript-message.js";
import type { TranscriptContentBlock, TranscriptStreamEvent } from "./types.js";

export function normalizeTuiEvent(event: unknown): TranscriptStreamEvent[] {
  const record = asRecord(event);
  switch (record.type) {
    case "turn_start": {
      const turnIndex = readTurnIndex(record.turnIndex);
      if (turnIndex === undefined) return [];
      const createdAt = readTimestamp(record.timestamp);
      return createdAt ? [{ type: "turn_start", turnIndex, createdAt }] : [{ type: "turn_start", turnIndex }];
    }
    case "turn_end": {
      const turnIndex = readTurnIndex(record.turnIndex);
      return turnIndex === undefined ? [] : [{ type: "turn_end", turnIndex }];
    }
    case "message_start":
      if (asRecord(record.message).role !== "assistant") return [];
      return transcriptMessageFromPiMessage({ id: messageId(record), timestamp: record.timestamp, message: record.message, isStreaming: true })
        .map((message) => ({ type: "transcript_message_start", message }));
    case "message_end":
      return transcriptMessageFromPiMessage({ id: messageId(record), timestamp: record.timestamp, message: record.message, isStreaming: false })
        .map((message) => ({ type: "transcript_message_end", message }));
    case "message_update":
      return normalizeMessageUpdate(record);
    case "tool_execution_start": {
      const toolCallId = readString(record.toolCallId);
      const toolName = readString(record.toolName);
      return toolCallId && toolName ? [{ type: "tool_execution_start", toolCallId, toolName, args: record.args }] : [];
    }
    case "tool_execution_update": {
      const toolCallId = readString(record.toolCallId);
      const toolName = readString(record.toolName);
      return toolCallId && toolName ? [{ type: "tool_execution_update", toolCallId, toolName, partialResult: record.partialResult }] : [];
    }
    case "tool_execution_end": {
      const toolCallId = readString(record.toolCallId);
      const toolName = readString(record.toolName);
      if (!toolCallId || !toolName) return [];
      return [{ type: "tool_execution_end", toolCallId, toolName, result: record.result, isError: record.isError === true }];
    }
    default:
      return [];
  }
}

function normalizeMessageUpdate(record: Record<string, unknown>): TranscriptStreamEvent[] {
  const id = messageId(record);
  if (!id) return [];
  const assistantMessageEvent = asRecord(record.assistantMessageEvent);
  const contentIndex = readContentIndex(assistantMessageEvent.contentIndex);
  if (assistantMessageEvent.type === "text_delta") {
    const delta = readString(assistantMessageEvent.delta) ?? readString(assistantMessageEvent.text);
    return delta === undefined ? [] : [{ type: "transcript_message_patch", messageId: id, contentIndex, patch: { type: "text_delta", delta } }];
  }
  if (assistantMessageEvent.type === "thinking_delta") {
    const delta = readString(assistantMessageEvent.delta) ?? readString(assistantMessageEvent.thinking);
    return delta === undefined ? [] : [{ type: "transcript_message_patch", messageId: id, contentIndex, patch: { type: "thinking_delta", delta } }];
  }
  if (assistantMessageEvent.type === "toolcall_end") {
    const toolCall = normalizeToolCall(assistantMessageEvent.toolCall);
    return toolCall ? [{ type: "transcript_message_patch", messageId: id, contentIndex, patch: { type: "toolCall", toolCall } }] : [];
  }
  if (assistantMessageEvent.type === "done" || assistantMessageEvent.type === "error") {
    return transcriptMessageFromPiMessage({ id, timestamp: record.timestamp, message: record.message, isStreaming: false })
      .map((message) => ({ type: "transcript_message_end", message }));
  }
  return [];
}

function messageId(record: Record<string, unknown>): string | undefined {
  return readString(record.id) ?? readString(asRecord(record.message).id);
}

function readContentIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readTurnIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeToolCall(value: unknown): Extract<TranscriptContentBlock, { type: "toolCall" }> | undefined {
  const record = asRecord(value);
  if (record.type !== "toolCall") return undefined;
  const id = readString(record.id);
  const name = readString(record.name);
  return id && name ? { type: "toolCall", id, name, arguments: record.arguments } : undefined;
}
