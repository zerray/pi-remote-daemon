import type { TranscriptMessage } from "./types.js";

export const DEFAULT_TRANSCRIPT_PAGE_LIMIT = 100;
export const MAX_TRANSCRIPT_PAGE_LIMIT = 200;

export type TranscriptPage = {
  messages: TranscriptMessage[];
  olderMessagesCursor: string | null;
  hasOlderMessages: boolean;
};

export class InvalidTranscriptCursorError extends Error {
  constructor() {
    super("invalid_cursor");
  }
}

export function encodeTranscriptCursor(createdAt: string): string {
  return Buffer.from(createdAt, "utf8").toString("base64url");
}

export function decodeTranscriptCursor(cursor: string): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidTranscriptCursorError();
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded || Number.isNaN(Date.parse(decoded)) || encodeTranscriptCursor(decoded) !== cursor) throw new InvalidTranscriptCursorError();
    return decoded;
  } catch (error) {
    if (error instanceof InvalidTranscriptCursorError) throw error;
    throw new InvalidTranscriptCursorError();
  }
}

export function recentTranscriptWindow(messages: TranscriptMessage[], limit: number): TranscriptPage {
  return pageFromCandidates(normalizeMessages(messages), limit);
}

export function olderTranscriptPage(messages: TranscriptMessage[], beforeCursor: string, limit: number): TranscriptPage {
  const beforeCreatedAt = decodeTranscriptCursor(beforeCursor);
  const normalizedMessages = normalizeMessages(messages);
  if (!normalizedMessages.some((message) => message.createdAt === beforeCreatedAt)) throw new InvalidTranscriptCursorError();
  return pageFromCandidates(
    normalizedMessages.filter((message) => message.createdAt < beforeCreatedAt),
    limit,
  );
}

function pageFromCandidates(candidates: TranscriptMessage[], limit: number): TranscriptPage {
  const start = Math.max(0, candidates.length - limit);
  const pageMessages = candidates.slice(start);
  const hasOlderMessages = start > 0;
  return {
    messages: pageMessages,
    olderMessagesCursor: hasOlderMessages && pageMessages[0] ? encodeTranscriptCursor(pageMessages[0].createdAt) : null,
    hasOlderMessages,
  };
}

function normalizeMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  const byId = new Map<string, TranscriptMessage>();
  for (const message of messages) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) => {
    const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
    return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
  });
}
