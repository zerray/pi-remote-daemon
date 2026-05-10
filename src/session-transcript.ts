import { readFileSync } from "node:fs";
import type { ChatMessage } from "./active-session-registry.js";

export function readSessionTranscriptMessages(sessionFile: string): ChatMessage[] {
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

function messagesFromEntry(entry: unknown): ChatMessage[] {
  const record = asRecord(entry);
  if (record.type !== "message") return [];
  const message = asRecord(record.message);
  const role = messageRole(message.role);
  if (!role) return [];
  return [{
    id: readString(record.id) ?? `msg_${Math.random().toString(36).slice(2, 10)}`,
    role,
    text: messageText(message.content),
    createdAt: readString(record.timestamp) ?? new Date().toISOString(),
    isStreaming: false,
  }];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function messageRole(value: unknown): ChatMessage["role"] | undefined {
  return value === "user" || value === "assistant" || value === "toolResult" || value === "system" ? value : undefined;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    const record = asRecord(item);
    return readString(record.text) ?? "";
  }).join("");
}
