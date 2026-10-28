import { Chess } from "chess.js";
import type { CompletionRequest, CompletionResult, LlmClient } from "./types";

const QUIPS = [
  "Calculated. Probably.",
  "I saw that coming. Mostly.",
  "Bold, I know.",
  "Trust the process.",
];

/**
 * An offline stand-in for an LLM: plays random legal moves through the same
 * tool-calling protocol. Lets you try the UI and harness without an API key.
 */
export class RandomMoverClient implements LlmClient {
  private readonly rng: () => number;
  private readonly delayMs: number;

  constructor(opts: { rng?: () => number; delayMs?: number } = {}) {
    this.rng = opts.rng ?? Math.random;
    this.delayMs = opts.delayMs ?? 400;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    const prompt = req.messages.find((m) => m.role === "user" && m.content.includes("FEN: "));
    const fen = prompt?.content && /FEN: (.+)/.exec(prompt.content)?.[1];
    const moves = new Chess(fen ?? undefined).moves();
    const pick = <T>(xs: T[]) => xs[Math.floor(this.rng() * xs.length)]!;
    const firstCall = req.messages.length === 2;

    const call = (name: string, args: object) => ({
      id: `rm-${this.rng().toString(36).slice(2)}`,
      name,
      arguments: JSON.stringify(args),
    });
    const toolCalls = [];
    if (firstCall && this.rng() < 0.15) {
      toolCalls.push(call("make_move", { move: "Qxh9" })); // a classic hallucination
    } else {
      if (firstCall && this.rng() < 0.3)
        toolCalls.push(
          call("write_notes", { notes: `Still winging it. ${moves.length} options last time.` }),
        );
      toolCalls.push(
        call("make_move", { move: pick(moves), ...(this.rng() < 0.2 && { say: pick(QUIPS) }) }),
      );
    }
    return { content: null, reasoning: null, toolCalls, costUsd: 0, tokens: 0 };
  }
}
