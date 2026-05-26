import { recentTranscriptWindow } from "./transcript-pagination.js";
import type { TranscriptContentBlock, TranscriptMessage } from "./types.js";

export const INITIAL_WEBSOCKET_SESSION_MESSAGE_LIMIT = 20;
export const INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES = 10 * 1024;

type SessionStateWithMessages = {
  messages?: TranscriptMessage[];
  hasOlderMessages?: boolean;
};

export function previewInitialSessionState<T>(state: T): T {
  if (!isRecord(state) || !Array.isArray((state as SessionStateWithMessages).messages)) return state;
  const messages = (state as SessionStateWithMessages).messages ?? [];
  const page = recentTranscriptWindow(messages, INITIAL_WEBSOCKET_SESSION_MESSAGE_LIMIT);
  return {
    ...state,
    messages: page.messages.map(previewTranscriptMessage),
    hasOlderMessages: (state as SessionStateWithMessages).hasOlderMessages || page.hasOlderMessages,
  };
}

function previewTranscriptMessage(message: TranscriptMessage): TranscriptMessage {
  const text = previewString(message.text);
  return {
    ...message,
    content: message.content.map(previewContentBlock),
    text: text.value,
    ...(text.truncated ? { textTruncated: true, textOriginalBytes: text.originalBytes } : {}),
  };
}

function previewContentBlock(block: TranscriptContentBlock): TranscriptContentBlock {
  if (block.type === "text") {
    const text = previewString(block.text);
    return text.truncated ? { ...block, text: text.value, truncated: true, originalBytes: text.originalBytes } : { ...block };
  }
  if (block.type === "thinking") {
    const thinking = previewString(block.thinking);
    return thinking.truncated ? { ...block, thinking: thinking.value, truncated: true, originalBytes: thinking.originalBytes } : { ...block };
  }
  if (block.type === "image") {
    const data = previewString(block.data);
    return data.truncated ? { ...block, data: data.value, truncated: true, originalBytes: data.originalBytes } : { ...block };
  }
  const originalBytes = jsonByteLength(block.arguments);
  const { value, truncated } = previewUnknownStrings(block.arguments);
  return truncated ? { ...block, arguments: value, argumentsTruncated: true, argumentsOriginalBytes: originalBytes } : { ...block, arguments: value };
}

function previewUnknownStrings(value: unknown): { value: unknown; truncated: boolean } {
  if (typeof value === "string") {
    const preview = previewString(value);
    return { value: preview.value, truncated: preview.truncated };
  }
  if (Array.isArray(value)) {
    let truncated = false;
    const items = value.map((item) => {
      const preview = previewUnknownStrings(item);
      truncated ||= preview.truncated;
      return preview.value;
    });
    return { value: items, truncated };
  }
  if (isRecord(value)) {
    let truncated = false;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const preview = previewUnknownStrings(item);
      truncated ||= preview.truncated;
      result[key] = preview.value;
    }
    return { value: result, truncated };
  }
  return { value, truncated: false };
}

function previewString(value: string): { value: string; truncated: false } | { value: string; truncated: true; originalBytes: number } {
  const originalBytes = Buffer.byteLength(value, "utf8");
  if (originalBytes <= INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES) return { value, truncated: false };
  return { value: truncateUtf8(value, INITIAL_WEBSOCKET_STRING_PREVIEW_BYTES), truncated: true, originalBytes };
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  for (let end = maxBytes; end >= 0; end -= 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
    } catch {
      // Try a smaller prefix when maxBytes cuts through a multi-byte sequence.
    }
  }
  return "";
}

function jsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
