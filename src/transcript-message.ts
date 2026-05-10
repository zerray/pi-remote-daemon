import type { TranscriptContentBlock, TranscriptMessage } from "./types.js";

export function transcriptMessageFromPiMessage(input: {
  id?: unknown;
  timestamp?: unknown;
  message?: unknown;
  isStreaming?: boolean;
}): TranscriptMessage[] {
  const message = asRecord(input.message);
  const role = messageRole(message.role);
  if (!role) return [];
  const content = transcriptContent(message.content);
  const result: TranscriptMessage = {
    id: readString(input.id) ?? readString(message.id) ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
    role,
    content,
    text: transcriptText(content),
    createdAt: readTimestamp(input.timestamp) ?? readTimestamp(message.timestamp) ?? new Date().toISOString(),
    isStreaming: input.isStreaming ?? false,
  };
  const toolCallId = readString(message.toolCallId);
  if (toolCallId) result.toolCallId = toolCallId;
  const toolName = readString(message.toolName);
  if (toolName) result.toolName = toolName;
  if (typeof message.isError === "boolean") result.isError = message.isError;
  return [result];
}

export function transcriptContent(content: unknown): TranscriptContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap<TranscriptContentBlock>((item) => {
    const record = asRecord(item);
    if (record.type === "text") {
      const text = readString(record.text);
      return text === undefined ? [] : [{ type: "text", text } satisfies TranscriptContentBlock];
    }
    if (record.type === "thinking") {
      const thinking = readString(record.thinking);
      return thinking === undefined ? [] : [{ type: "thinking", thinking } satisfies TranscriptContentBlock];
    }
    if (record.type === "toolCall") {
      const id = readString(record.id);
      const name = readString(record.name);
      return id && name ? [{ type: "toolCall", id, name, arguments: record.arguments } satisfies TranscriptContentBlock] : [];
    }
    if (record.type === "image") {
      const data = readString(record.data);
      const mimeType = readString(record.mimeType);
      return data && mimeType ? [{ type: "image", data, mimeType } satisfies TranscriptContentBlock] : [];
    }
    return [];
  });
}

export function transcriptText(content: TranscriptContentBlock[]): string {
  return content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return undefined;
}

function messageRole(value: unknown): TranscriptMessage["role"] | undefined {
  return value === "user" || value === "assistant" || value === "toolResult" || value === "system" ? value : undefined;
}
