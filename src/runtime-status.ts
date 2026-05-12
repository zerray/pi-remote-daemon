import type { RuntimeStatus } from "./types.js";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

type RuntimeStatusUsage = RuntimeStatus["usage"];

export function collectRuntimeStatus(pi: unknown, ctx: unknown, now: () => Date = () => new Date()): RuntimeStatus {
  const context = asRecord(ctx);
  return {
    model: collectModel(context.model),
    thinkingLevel: collectThinkingLevel(pi),
    usage: collectUsage(readSessionEntries(context)),
    context: collectContextUsage(callNoArgs(context.getContextUsage)),
    updatedAt: now().toISOString(),
  };
}

function collectModel(value: unknown): RuntimeStatus["model"] {
  const model = asRecord(value);
  const provider = readString(model.provider);
  const id = readString(model.id) ?? readString(model.model);
  if (!provider || !id) return null;
  return withoutUndefined({
    provider,
    id,
    name: readString(model.name),
    contextWindow: readNumber(model.contextWindow) ?? readNumber(model.context_window),
    maxTokens: readNumber(model.maxTokens) ?? readNumber(model.max_tokens),
    reasoning: readBoolean(model.reasoning),
  });
}

function collectThinkingLevel(pi: unknown): RuntimeStatus["thinkingLevel"] {
  const level = callNoArgs(asRecord(pi).getThinkingLevel);
  return typeof level === "string" && THINKING_LEVELS.has(level) ? level as RuntimeStatus["thinkingLevel"] : null;
}

function collectContextUsage(value: unknown): RuntimeStatus["context"] {
  const usage = asRecord(value);
  const contextWindow = readNumber(usage.contextWindow) ?? readNumber(usage.context_window) ?? readNumber(usage.maxTokens) ?? readNumber(usage.max_tokens);
  if (contextWindow === undefined) return null;
  const tokens = readNumber(usage.tokens) ?? readNumber(usage.currentTokens) ?? readNumber(usage.current_tokens);
  const percent = readNumber(usage.percent) ?? readNumber(usage.percentage);
  return {
    tokens: tokens ?? null,
    contextWindow,
    percent: percent ?? null,
  };
}

function collectUsage(entries: unknown[]): RuntimeStatusUsage {
  const usage: RuntimeStatusUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  for (const entry of entries) {
    const record = asRecord(entry);
    const message = asRecord(record.message);
    if (message.role !== "assistant" && record.role !== "assistant") continue;
    const entryUsage = asRecord(record.usage ?? message.usage);
    usage.input += readNumber(entryUsage.input) ?? 0;
    usage.output += readNumber(entryUsage.output) ?? 0;
    usage.cacheRead += readNumber(entryUsage.cacheRead) ?? readNumber(entryUsage.cache_read) ?? 0;
    usage.cacheWrite += readNumber(entryUsage.cacheWrite) ?? readNumber(entryUsage.cache_write) ?? 0;

    const cost = asRecord(entryUsage.cost);
    usage.cost.input += readNumber(cost.input) ?? 0;
    usage.cost.output += readNumber(cost.output) ?? 0;
    usage.cost.cacheRead += readNumber(cost.cacheRead) ?? readNumber(cost.cache_read) ?? 0;
    usage.cost.cacheWrite += readNumber(cost.cacheWrite) ?? readNumber(cost.cache_write) ?? 0;
    usage.cost.total += readNumber(cost.total) ?? 0;
  }

  usage.cost.total = usage.cost.total || usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  return usage;
}

function readSessionEntries(context: Record<string, unknown>): unknown[] {
  const sessionManager = asRecord(context.sessionManager);
  const entries = callNoArgs(sessionManager.getEntries);
  return Array.isArray(entries) ? entries : [];
}

function callNoArgs(value: unknown): unknown {
  if (typeof value !== "function") return undefined;
  try {
    return (value as () => unknown)();
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}
