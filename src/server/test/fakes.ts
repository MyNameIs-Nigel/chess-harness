import { Chess } from "chess.js";
import { winPercent } from "../../shared/analysis";
import type { GameSnapshot, PositionEval } from "../../shared/types";
import type { Analyzer, EnginePlayer } from "../engine/stockfish";
import type { GameSession, SessionDeps } from "../game/session";
import type { CompletionRequest, CompletionResult, LlmClient } from "../llm/types";

type Step =
  Partial<CompletionResult> | Error | ((req: CompletionRequest) => Partial<CompletionResult>);

/** An LLM that replays a script, one step per call, and records every request. */
export class ScriptedLlm implements LlmClient {
  readonly requests: CompletionRequest[] = [];
  private readonly steps: Step[];
  private readonly delayMs: number;

  constructor(steps: Step[], delayMs = 0) {
    this.steps = steps;
    this.delayMs = delayMs;
  }

  push(...steps: Step[]) {
    this.steps.push(...steps);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(structuredClone({ ...req, signal: undefined }));
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    req.signal?.throwIfAborted();
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedLlm: script exhausted");
    if (step instanceof Error) throw step;
    const res = typeof step === "function" ? step(req) : step;
    return { content: null, reasoning: null, toolCalls: [], costUsd: 0.001, tokens: 100, ...res };
  }

  /** The user-visible state message of the n-th request. */
  prompt(n: number): string {
    const msg = this.requests[n]?.messages[1];
    return msg && "content" in msg ? (msg.content ?? "") : "";
  }
}

let callId = 0;
export const call = (name: string, args: object = {}) => ({
  toolCalls: [{ id: `call-${++callId}`, name, arguments: JSON.stringify(args) }],
});
export const move = (san: string, extra: object = {}) => call("make_move", { move: san, ...extra });

/** Material-count "engine": deterministic and instant. Best move = first legal move. */
export class MaterialAnalyzer implements Analyzer {
  async evaluate(fen: string): Promise<PositionEval> {
    const chess = new Chess(fen);
    const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let cp = 0;
    for (const p of chess.board().flat())
      if (p) cp += (p.color === "w" ? 100 : -100) * value[p.type]!;
    const best = chess.moves({ verbose: true })[0];
    if (chess.isCheckmate()) {
      return {
        score: { mate: 0 },
        whiteWin: chess.turn() === "w" ? 0 : 100,
        bestUci: null,
        bestSan: null,
      };
    }
    return {
      score: { cp },
      whiteWin: winPercent({ cp }),
      bestUci: best?.lan ?? null,
      bestSan: best?.san ?? null,
    };
  }
}

export function fakeEnginePlayer(moves: string[]): EnginePlayer & { quit: () => void } {
  return { bestMove: async () => moves.shift() ?? "(none)", quit: () => {} };
}

export function deps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    llm: new ScriptedLlm([]),
    analyzer: new MaterialAnalyzer(),
    startEnginePlayer: async () => fakeEnginePlayer([]),
    ...overrides,
  };
}

export function waitFor(
  session: GameSession,
  pred: (s: GameSnapshot) => boolean,
  ms = 3000,
): Promise<GameSnapshot> {
  return new Promise((resolve, reject) => {
    const now = session.snapshot();
    if (pred(now)) return resolve(now);
    const off = session.subscribe((s) => {
      if (!pred(s)) return;
      clearTimeout(timer);
      off();
      resolve(s);
    });
    const timer = setTimeout(() => {
      off();
      reject(
        new Error(
          `waitFor timed out; last state: ${JSON.stringify(session.snapshot()).slice(0, 400)}`,
        ),
      );
    }, ms);
  });
}
