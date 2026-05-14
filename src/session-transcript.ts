import { readFileSync } from "node:fs";
import { asRecord, readString, transcriptMessageFromPiMessage } from "./transcript-message.js";
import type { TranscriptMessage } from "./types.js";

export function visibleConversationMessageCount(messages: TranscriptMessage[]): number {
  return messages.filter((message) => message.role === "user" || message.role === "assistant").length;
}

export function readSessionTranscriptMessages(sessionFile: string): TranscriptMessage[] {
  let text: string;
  try {
    text = readFileSync(sessionFile, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  return text.split(/\r?\n/u).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      return messagesFromEntry(JSON.parse(trimmed));
    } catch {
      return [];
    }
  });
}

function messagesFromEntry(entry: unknown): TranscriptMessage[] {
  const record = asRecord(entry);
  if (record.type !== "message") return [];
  return transcriptMessageFromPiMessage({
    id: readString(record.id),
    timestamp: readString(record.timestamp),
    message: record.message,
    isStreaming: false,
  });
}
