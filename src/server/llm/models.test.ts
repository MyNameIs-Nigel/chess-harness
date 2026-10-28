import { describe, expect, it, vi } from "vitest";
import { createModelCatalog, OFFLINE_MODEL_ID, parseModels } from "./models";

const wire = {
  data: [
    {
      id: "pricey/big",
      name: "Big",
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools"],
    },
    {
      id: "cheap/small",
      name: "Small",
      pricing: { prompt: "0.0000001", completion: "0.0000004" },
      supported_parameters: ["tools", "reasoning"],
    },
    {
      id: "no/tools",
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["temperature"],
    },
    {
      id: "openrouter/auto",
      pricing: { prompt: "-1", completion: "-1" },
      supported_parameters: ["tools"],
    },
  ],
};

describe("parseModels", () => {
  it("keeps priced tool-capable models, cheapest first, in $/M tokens", () => {
    const models = parseModels(wire);
    expect(models.map((m) => m.id)).toEqual(["cheap/small", "pricey/big"]);
    expect(models[0]).toMatchObject({ promptPrice: 0.1, completionPrice: 0.4, reasoning: true });
  });
});

describe("createModelCatalog", () => {
  it("caches the live list and always offers the offline bot first", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(wire)));
    const catalog = createModelCatalog({
      baseUrl: "https://x.test",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const first = await catalog();
    await catalog();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first.live).toBe(true);
    expect(first.models[0]!.id).toBe(OFFLINE_MODEL_ID);
    expect(first.models.map((m) => m.id)).toContain("cheap/small");
  });

  it("falls back to the built-in list when OpenRouter is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = (async () => {
      throw new Error("blocked");
    }) as unknown as typeof globalThis.fetch;
    const res = await createModelCatalog({ baseUrl: "https://x.test", fetch })();
    expect(res.live).toBe(false);
    expect(res.models.length).toBeGreaterThan(3);
    expect(res.recommended.every((id) => res.models.some((m) => m.id === id))).toBe(true);
  });
});
