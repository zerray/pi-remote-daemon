export type TranscriptEventCanonicalizer = {
  canonicalize(event: unknown, ctx: { sessionManager: { getEntries(): unknown[] } }): unknown[];
  reset(): void;
};

type CanonicalEntry = { id: string; timestamp?: string };

const MESSAGE_EVENT_TYPES = new Set(["message_start", "message_update", "message_end"]);

export function createTranscriptEventCanonicalizer(): TranscriptEventCanonicalizer {
  const canonicalIdsByTemporaryId = new Map<string, CanonicalEntry>();
  const pendingEventsByTemporaryId = new Map<string, unknown[]>();

  return {
    canonicalize(event, ctx) {
      const record = asRecord(event);
      if (!MESSAGE_EVENT_TYPES.has(readString(record.type) ?? "")) return [event];

      const temporaryId = messageId(record);
      const knownEntry = temporaryId ? canonicalIdsByTemporaryId.get(temporaryId) : undefined;
      if (knownEntry) return [rewriteEvent(record, knownEntry)];

      const entry = resolveCanonicalEntry(record, ctx.sessionManager.getEntries());
      if (!entry) {
        if (temporaryId) {
          const pendingEvents = pendingEventsByTemporaryId.get(temporaryId) ?? [];
          pendingEvents.push(event);
          pendingEventsByTemporaryId.set(temporaryId, pendingEvents);
        }
        return [];
      }

      if (temporaryId) canonicalIdsByTemporaryId.set(temporaryId, entry);
      const pendingEvents = temporaryId ? (pendingEventsByTemporaryId.get(temporaryId) ?? []) : [];
      if (temporaryId) pendingEventsByTemporaryId.delete(temporaryId);
      return [...pendingEvents, event].map((pendingEvent) => rewriteEvent(asRecord(pendingEvent), entry));
    },
    reset() {
      canonicalIdsByTemporaryId.clear();
      pendingEventsByTemporaryId.clear();
    },
  };
}

function resolveCanonicalEntry(record: Record<string, unknown>, entries: unknown[]): CanonicalEntry | undefined {
  const message = asRecord(record.message);
  const temporaryId = messageId(record);
  const sessionEntries = entries.flatMap((entry): Array<{ id: string; timestamp?: string; message: unknown }> => {
    const entryRecord = asRecord(entry);
    if (entryRecord.type !== "message") return [];
    const id = readString(entryRecord.id);
    if (!id) return [];
    return [{ id, timestamp: readString(entryRecord.timestamp), message: entryRecord.message }];
  });
  const entryWithSameId = sessionEntries.find((entry) => entry.id === temporaryId);
  if (entryWithSameId) return { id: entryWithSameId.id, timestamp: entryWithSameId.timestamp };
  const candidates = sessionEntries.filter((entry) => messagesMatch(entry.message, message));
  return candidates.length === 1 ? { id: candidates[0]!.id, timestamp: candidates[0]!.timestamp } : undefined;
}

function rewriteEvent(record: Record<string, unknown>, entry: CanonicalEntry): unknown {
  const message = asRecord(record.message);
  return {
    ...record,
    id: entry.id,
    timestamp: entry.timestamp ?? record.timestamp,
    message: { ...message, id: entry.id },
  };
}

function messagesMatch(left: unknown, right: unknown): boolean {
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (leftRecord.role !== rightRecord.role) return false;
  if (leftRecord.timestamp !== undefined && rightRecord.timestamp !== undefined) return leftRecord.timestamp === rightRecord.timestamp;
  return JSON.stringify(leftRecord.content) === JSON.stringify(rightRecord.content);
}

function messageId(record: Record<string, unknown>): string | undefined {
  return readString(record.id) ?? readString(asRecord(record.message).id);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
