import { createHash } from "node:crypto";
import type { ModelCatalogSnapshot, RemoteModelSummary } from "./types.js";

export type ModelCatalogContext = {
  model?: unknown;
  scopedModels?: readonly { model: unknown }[];
  modelRegistry: {
    refresh(): Promise<unknown>;
    getAvailable(): unknown[];
  };
};

export async function collectModelCatalog(
  ctx: ModelCatalogContext,
  now: () => Date = () => new Date(),
): Promise<ModelCatalogSnapshot> {
  await ctx.modelRegistry.refresh();
  const scopedKeys = new Set((ctx.scopedModels ?? []).flatMap((entry) => {
    const model = entry.model && typeof entry.model === "object" ? entry.model as Record<string, unknown> : {};
    return typeof model.provider === "string" && typeof model.id === "string" ? [`${model.provider}\0${model.id}`] : [];
  }));
  const hasScope = scopedKeys.size > 0;
  const models = ctx.modelRegistry.getAvailable().flatMap((value): RemoteModelSummary[] => {
    const model = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (typeof model.provider !== "string" || typeof model.id !== "string") return [];
    const key = `${model.provider}\0${model.id}`;
    return [{
      provider: model.provider,
      modelId: model.id,
      ...(typeof model.name === "string" ? { name: model.name } : {}),
      reasoning: model.reasoning === true,
      ...(typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) ? { contextWindow: model.contextWindow } : {}),
      ...(typeof model.maxTokens === "number" && Number.isFinite(model.maxTokens) ? { maxTokens: model.maxTokens } : {}),
      isScoped: hasScope && scopedKeys.has(key),
    }];
  });
  const current = ctx.model && typeof ctx.model === "object" ? ctx.model as Record<string, unknown> : {};
  const currentModel = typeof current.provider === "string" && typeof current.id === "string"
    ? models.find((model) => model.provider === current.provider && model.modelId === current.id) ?? null
    : null;
  const content = JSON.stringify({ currentModel, models });
  return {
    currentModel,
    models,
    catalogVersion: `modelsv_${createHash("sha256").update(content).digest("hex").slice(0, 16)}`,
    generatedAt: now().toISOString(),
  };
}
