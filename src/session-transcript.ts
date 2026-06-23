import { readFileSync } from "node:fs";
import { asRecord, readString, transcriptMessageFromPiMessage } from "./transcript-message.js";
import type { TranscriptMessage, TreeSnapshot } from "./types.js";

export function visibleConversationMessageCount(messages: TranscriptMessage[]): number {
  return messages.filter((message) => message.role === "user" || message.role === "assistant").length;
}

export function activeBranchEntryIds(snapshot: Pick<TreeSnapshot, "leafId" | "entries">): Set<string> | undefined {
  if (!snapshot.leafId) return undefined;
  const entriesById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  if (!entriesById.has(snapshot.leafId)) return undefined;
  const ids = new Set<string>();
  let currentId: string | null = snapshot.leafId;
  while (currentId) {
    if (ids.has(currentId)) return undefined;
    const entry = entriesById.get(currentId);
    if (!entry) return undefined;
    ids.add(currentId);
    currentId = entry.parentId;
  }
  return ids;
}

export function activeBranchEntryIdsFromSessionFile(sessionFile: string, leafId: string | null): Set<string> | undefined {
  if (!leafId) return undefined;
  let text: string;
  try {
    text = readFileSync(sessionFile, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const parentById = new Map<string, string | null>();
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = asRecord(JSON.parse(trimmed));
      const id = readString(entry.id);
      if (id) parentById.set(id, readString(entry.parentId) ?? null);
    } catch {
      continue;
    }
  }
  if (!parentById.has(leafId)) return undefined;
  const ids = new Set<string>();
  let currentId: string | null = leafId;
  while (currentId) {
    if (ids.has(currentId)) return undefined;
    if (!parentById.has(currentId)) return undefined;
    ids.add(currentId);
    currentId = parentById.get(currentId) ?? null;
  }
  return ids;
}

export function readSessionTranscriptMessages(sessionFile: string, options: { entryIds?: ReadonlySet<string> } = {}): TranscriptMessage[] {
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
      return messagesFromEntry(JSON.parse(trimmed), options);
    } catch {
      return [];
    }
  });
}

function messagesFromEntry(entry: unknown, options: { entryIds?: ReadonlySet<string> } = {}): TranscriptMessage[] {
  const record = asRecord(entry);
  if (record.type !== "message") return [];
  const id = readString(record.id);
  if (options.entryIds && (!id || !options.entryIds.has(id))) return [];
  return transcriptMessageFromPiMessage({
    id: readString(record.id),
    timestamp: readString(record.timestamp),
    message: record.message,
    isStreaming: false,
  });
}
