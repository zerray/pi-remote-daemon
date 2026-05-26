export type TranscriptEventCanonicalizer = {
  canonicalize(event: unknown, ctx: { sessionManager: { getEntries(): unknown[] } }): unknown[];
  drain(ctx: { sessionManager: { getEntries(): unknown[] } }): unknown[];
  hasPending(): boolean;
  reset(): void;
};

type CanonicalEntry = { id: string; timestamp?: string };
type PendingEvents = { events: unknown[]; drainAttempts: number };

const MESSAGE_EVENT_TYPES = new Set(["message_start", "message_update", "message_end"]);
const DEFAULT_MAX_DRAIN_ATTEMPTS = 300;

export function createTranscriptEventCanonicalizer(options: { maxDrainAttempts?: number } = {}): TranscriptEventCanonicalizer {
  const canonicalEntriesByCorrelationKey = new Map<string, CanonicalEntry>();
  const pendingEventsByCorrelationKey = new Map<string, PendingEvents>();
  const maxDrainAttempts = options.maxDrainAttempts ?? DEFAULT_MAX_DRAIN_ATTEMPTS;

  return {
    canonicalize(event, ctx) {
      const record = asRecord(event);
      if (!MESSAGE_EVENT_TYPES.has(readString(record.type) ?? "")) return [event];

      const key = correlationKey(record);
      const knownEntry = key ? canonicalEntriesByCorrelationKey.get(key) : undefined;
      if (knownEntry) return [rewriteEvent(record, knownEntry)];

      const entry = resolveCanonicalEntry(record, ctx.sessionManager.getEntries());
      if (!entry) {
        if (key) {
          const pending = pendingEventsByCorrelationKey.get(key) ?? { events: [], drainAttempts: 0 };
          pending.events.push(event);
          pendingEventsByCorrelationKey.set(key, pending);
        }
        return [];
      }

      if (key) canonicalEntriesByCorrelationKey.set(key, entry);
      const pendingEvents = key ? (pendingEventsByCorrelationKey.get(key)?.events ?? []) : [];
      if (key) pendingEventsByCorrelationKey.delete(key);
      return [...pendingEvents, event].map((pendingEvent) => rewriteEvent(asRecord(pendingEvent), entry));
    },
    drain(ctx) {
      const flushedEvents: unknown[] = [];
      for (const [key, pending] of [...pendingEventsByCorrelationKey.entries()]) {
        const entry = pending.events
          .map((pendingEvent) => resolveCanonicalEntry(asRecord(pendingEvent), ctx.sessionManager.getEntries()))
          .find((candidate) => candidate !== undefined);
        if (!entry) {
          pending.drainAttempts += 1;
          if (pending.drainAttempts >= maxDrainAttempts) pendingEventsByCorrelationKey.delete(key);
          continue;
        }
        canonicalEntriesByCorrelationKey.set(key, entry);
        pendingEventsByCorrelationKey.delete(key);
        flushedEvents.push(...pending.events.map((pendingEvent) => rewriteEvent(asRecord(pendingEvent), entry)));
      }
      return flushedEvents;
    },
    hasPending() {
      return pendingEventsByCorrelationKey.size > 0;
    },
    reset() {
      canonicalEntriesByCorrelationKey.clear();
      pendingEventsByCorrelationKey.clear();
    },
  };
}

function resolveCanonicalEntry(record: Record<string, unknown>, entries: unknown[]): CanonicalEntry | undefined {
  const eventMessage = asRecord(record.message);
  const eventMessageId = messageId(record);
  const eventRoleTimestampKey = roleTimestampKey(eventMessage);
  const sessionEntries = entries.flatMap((entry): Array<{ id: string; timestamp?: string; roleTimestampKey?: string }> => {
    const entryRecord = asRecord(entry);
    if (entryRecord.type !== "message") return [];
    const id = readString(entryRecord.id);
    if (!id) return [];
    return [{ id, timestamp: readString(entryRecord.timestamp), roleTimestampKey: roleTimestampKey(asRecord(entryRecord.message)) }];
  });
  const entryWithSameId = sessionEntries.find((entry) => entry.id === eventMessageId);
  if (entryWithSameId) return { id: entryWithSameId.id, timestamp: entryWithSameId.timestamp };
  if (!eventRoleTimestampKey) return undefined;
  const candidates = sessionEntries.filter((entry) => entry.roleTimestampKey === eventRoleTimestampKey);
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

function correlationKey(record: Record<string, unknown>): string | undefined {
  const id = messageId(record);
  if (id) return `id:${id}`;
  const key = roleTimestampKey(asRecord(record.message));
  return key ? `role-timestamp:${key}` : undefined;
}

function roleTimestampKey(message: Record<string, unknown>): string | undefined {
  const role = readString(message.role);
  if (!role || message.timestamp === undefined) return undefined;
  return `${role}:${String(message.timestamp)}`;
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
