import type { ModelInfo } from "../../shared/types";

export const OFFLINE_MODEL_ID = "local/random-mover";

const offline: ModelInfo = {
  id: OFFLINE_MODEL_ID,
  name: "Random mover (offline test bot, free)",
  promptPrice: 0,
  completionPrice: 0,
  reasoning: false,
};

/**
 * Cheap tool-capable models that played sensibly in live arena runs (Oct 2026).
 * Prices are fallbacks for when the live catalog is unreachable.
 */
const RECOMMENDED: ModelInfo[] = [
  {
    id: "anthropic/claude-haiku-5.5",
    name: "Anthropic: Claude Haiku 5.5",
    promptPrice: 0.1,
    completionPrice: 0.5,
    reasoning: true,
  },
  {
    id: "openai/gpt-6-luna",
    name: "OpenAI: GPT-6 Luna",
    promptPrice: 0.1,
    completionPrice: 0.5,
    reasoning: true,
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek: V4.1 Flash",
    promptPrice: 0.14,
    completionPrice: 0.42,
    reasoning: true,
  },
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Google: Gemini 2.5 Flash Lite",
    promptPrice: 0.1,
    completionPrice: 0.4,
    reasoning: true,
  },
  {
    id: "qwen/qwen3.7-flash",
    name: "Qwen: Qwen3.7 Flash",
    promptPrice: 0.03,
    completionPrice: 0.13,
    reasoning: true,
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct",
    name: "Mistral: Mistral Small 3.2 24B",
    promptPrice: 0.075,
    completionPrice: 0.2,
    reasoning: false,
  },
];
export const RECOMMENDED_IDS = RECOMMENDED.map((m) => m.id);

interface WireModel {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

const perMillion = (perToken: string | undefined) =>
  Number((Number(perToken ?? NaN) * 1e6).toPrecision(6));

export function parseModels(data: { data?: WireModel[] }): ModelInfo[] {
  return (
    (data.data ?? [])
      // ":batch" variants are rejected by chat/completions.
      .filter((m) => m.supported_parameters?.includes("tools") && !m.id.endsWith(":batch"))
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        promptPrice: perMillion(m.pricing?.prompt),
        completionPrice: perMillion(m.pricing?.completion),
        reasoning: m.supported_parameters?.includes("reasoning") ?? false,
      }))
      .filter((m) => m.promptPrice >= 0 && m.completionPrice >= 0)
      .sort(
        (a, b) => a.promptPrice * 5 + a.completionPrice - (b.promptPrice * 5 + b.completionPrice),
      )
  );
}

/** Live OpenRouter catalog (cached), falling back to the built-in list when offline. */
export function createModelCatalog(opts: {
  baseUrl: string;
  ttlMs?: number;
  fetch?: typeof fetch;
}) {
  const doFetch = opts.fetch ?? fetch;
  let cache: { at: number; models: ModelInfo[] } | null = null;
  return async (): Promise<{ models: ModelInfo[]; recommended: string[]; live: boolean }> => {
    if (!cache || Date.now() - cache.at > (opts.ttlMs ?? 3_600_000)) {
      try {
        const res = await doFetch(`${opts.baseUrl}/models`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const models = parseModels((await res.json()) as { data?: WireModel[] });
        if (!models.length) throw new Error("no tool-capable models");
        cache = { at: Date.now(), models };
      } catch (err) {
        console.warn(`Model list unavailable (${(err as Error).message}); using built-in list`);
        return { models: [offline, ...RECOMMENDED], recommended: RECOMMENDED_IDS, live: false };
      }
    }
    return { models: [offline, ...cache.models], recommended: RECOMMENDED_IDS, live: true };
  };
}
