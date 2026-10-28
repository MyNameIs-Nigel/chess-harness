import { StockfishAnalyzer, startEnginePlayer } from "./engine/stockfish";
import type { SessionDeps } from "./game/session";
import { OFFLINE_MODEL_ID } from "./llm/models";
import { OpenRouterClient } from "./llm/openrouter";
import { RandomMoverClient } from "./llm/random-mover";
import type { LlmClient } from "./llm/types";

export interface Config {
  port: number;
  apiKey: string | undefined;
  baseUrl: string;
  stockfishPath: string | undefined;
  analysisDepth: number;
}

export function loadConfig(env = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    apiKey: env.OPENROUTER_API_KEY || undefined,
    baseUrl: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    stockfishPath: env.STOCKFISH_PATH || undefined,
    analysisDepth: Number(env.ANALYSIS_DEPTH ?? 14),
  };
}

/** Wire real collaborators: OpenRouter (plus the offline bot) and Stockfish. */
export function createDeps(config: Config): SessionDeps & { shutdown(): Promise<void> } {
  const remote = new OpenRouterClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const offline = new RandomMoverClient();
  const llm: LlmClient = {
    complete: (req) => (req.model === OFFLINE_MODEL_ID ? offline : remote).complete(req),
  };
  const analyzer = new StockfishAnalyzer(config.stockfishPath, config.analysisDepth);
  return {
    llm,
    analyzer,
    startEnginePlayer: (skill) => startEnginePlayer(skill, config.stockfishPath),
    shutdown: () => analyzer.quit(),
  };
}
