import { completeSimple } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ActiveSessionNameGenerator } from "./active-session-registry.js";
import type { TranscriptMessage } from "./types.js";

const MAX_PROMPT_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 500;
const MAX_NAME_CHARS = 80;

type SessionNameModel = { provider: string; id: string };
type SessionNameModelRegistry = {
  find(provider: string, modelId: string): SessionNameModel | undefined;
  getAvailable(): SessionNameModel[];
  getApiKeyAndHeaders(model: SessionNameModel): Promise<{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }>;
};
type SessionNameComplete = (model: SessionNameModel, context: { messages: Array<{ role: "user"; content: string; timestamp: number }> }, options?: { apiKey?: string; headers?: Record<string, string>; maxTokens?: number; temperature?: number; reasoning?: "off" }) => Promise<{ content: Array<{ type: string; text?: string }> }>;

export type LlmSessionNameGeneratorDependencies = {
  modelRegistry?: SessionNameModelRegistry;
  complete?: SessionNameComplete;
};

export function createLlmSessionNameGenerator(deps: LlmSessionNameGeneratorDependencies = {}): ActiveSessionNameGenerator {
  const modelRegistry = deps.modelRegistry ?? defaultModelRegistry();
  const complete = deps.complete ?? defaultComplete;

  return async (request) => {
    const prompt = buildSessionNamePrompt(request.messages);
    if (!prompt) return null;

    const preferredModel = request.runtimeStatus?.model
      ? modelRegistry.find(request.runtimeStatus.model.provider, request.runtimeStatus.model.id)
      : undefined;
    const model = preferredModel ?? modelRegistry.getAvailable()[0];
    if (!model) return null;

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return null;

    const response = await complete(model, {
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    }, {
      apiKey: auth.apiKey,
      headers: auth.headers,
      maxTokens: 32,
      temperature: 0,
      reasoning: "off",
    });
    return sanitizeGeneratedSessionName(response.content.flatMap((block) => block.type === "text" && block.text ? [block.text] : []).join(""));
  };
}

export function buildSessionNamePrompt(messages: TranscriptMessage[]): string | null {
  const transcript = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, text: cleanText(message.text).slice(0, MAX_MESSAGE_CHARS) }))
    .filter((message) => message.text.length > 0)
    .slice(-MAX_PROMPT_MESSAGES)
    .map((message) => `${message.role}: ${message.text}`)
    .join("\n");

  if (!transcript) return null;
  return [
    "Generate a short display name for this coding-agent session.",
    "Return only the name, with no quotes, markdown, punctuation-only suffix, or explanation.",
    "Keep it under 8 words.",
    "",
    "Transcript excerpt:",
    transcript,
  ].join("\n");
}

export function sanitizeGeneratedSessionName(name: string | null | undefined): string | null {
  const cleaned = cleanText(name ?? "").replace(/^['"“”‘’]+|['"“”‘’]+$/gu, "").trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_NAME_CHARS ? `${cleaned.slice(0, MAX_NAME_CHARS - 3)}...` : cleaned;
}

function defaultModelRegistry(): SessionNameModelRegistry {
  return ModelRegistry.create(AuthStorage.create()) as unknown as SessionNameModelRegistry;
}

async function defaultComplete(model: SessionNameModel, context: { messages: Array<{ role: "user"; content: string; timestamp: number }> }, options?: { apiKey?: string; headers?: Record<string, string>; maxTokens?: number; temperature?: number; reasoning?: "off" }): Promise<{ content: Array<{ type: string; text?: string }> }> {
  return completeSimple(model as never, context as never, options as never) as Promise<{ content: Array<{ type: string; text?: string }> }>;
}

function cleanText(text: string): string {
  return text.replace(/[\p{C}\s]+/gu, " ").trim();
}
