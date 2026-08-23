import { describe, expect, it, vi } from "vitest";
import { collectModelCatalog } from "../src/model-catalog.js";

describe("TUI-owned Model Catalog Snapshot", () => {
  it("refreshes and reduces authenticated models without exposing provider secrets", async () => {
    const refresh = vi.fn(async () => ({ aborted: false, errors: new Map() }));
    const claude = {
      provider: "anthropic",
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 8192,
      baseUrl: "https://secret-proxy.example/v1",
      apiKey: "must-not-leak",
      headers: { authorization: "must-not-leak" },
    };
    const gpt = {
      provider: "openai",
      id: "gpt-5",
      name: "GPT-5",
      reasoning: true,
      contextWindow: 400000,
      maxTokens: 128000,
      baseUrl: "https://api.openai.com/v1",
    };
    const ctx = {
      model: claude,
      scopedModels: [{ model: claude }],
      modelRegistry: { refresh, getAvailable: () => [claude, gpt] },
    };

    const catalog = await collectModelCatalog(ctx, () => new Date("2026-05-09T09:47:00.000Z"));

    expect(refresh).toHaveBeenCalledOnce();
    expect(catalog).toEqual({
      currentModel: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        contextWindow: 200000,
        maxTokens: 8192,
        isScoped: true,
      },
      models: [
        {
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
          reasoning: true,
          contextWindow: 200000,
          maxTokens: 8192,
          isScoped: true,
        },
        {
          provider: "openai",
          modelId: "gpt-5",
          name: "GPT-5",
          reasoning: true,
          contextWindow: 400000,
          maxTokens: 128000,
          isScoped: false,
        },
      ],
      catalogVersion: expect.stringMatching(/^modelsv_[a-f0-9]{16}$/),
      generatedAt: "2026-05-09T09:47:00.000Z",
    });
    expect(JSON.stringify(catalog)).not.toContain("must-not-leak");
    expect(JSON.stringify(catalog)).not.toContain("baseUrl");
  });

  it("treats an empty Pi scope as unrestricted instead of a scoped subset", async () => {
    const models = [
      { provider: "anthropic", id: "claude-sonnet-4-5", reasoning: true },
      { provider: "openai", id: "gpt-5", reasoning: true },
    ];
    const catalog = await collectModelCatalog({
      model: models[0],
      scopedModels: [],
      modelRegistry: { refresh: async () => undefined, getAvailable: () => models },
    });

    expect(catalog.models.map((model) => model.isScoped)).toEqual([false, false]);
  });
});
