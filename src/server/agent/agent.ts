import { Chess } from "chess.js";
import type { LlmPlayer, MindEntry } from "../../shared/types";
import { randomLegalMove } from "../chess/moves";
import type { LlmClient, LlmMessage } from "../llm/types";
import { systemPrompt, turnPrompt, type TurnContext } from "./prompt";
import {
  executeTool,
  salvageToolCalls,
  toolSpecs,
  type ToolState,
  type TurnDecision,
} from "./tools";

export interface AgentOptions {
  /** Model calls allowed before the harness plays a random move. */
  maxCalls?: number;
  signal?: AbortSignal;
  onEntry?: (entry: MindEntry) => void;
  onUsage?: (usage: { costUsd: number; tokens: number }) => void;
  rng?: () => number;
}

export interface TurnOutcome {
  decision: TurnDecision;
  /** True when the model never produced a legal action and the harness moved for it. */
  fallback: boolean;
  notes: string;
  illegalMoves: number;
}

const NUDGE =
  "You did not call a tool. Reply with a tool call: make_move to play, write_notes to save notes, or resign.";

export async function playLlmTurn(
  llm: LlmClient,
  player: LlmPlayer,
  ctx: TurnContext,
  opts: AgentOptions = {},
): Promise<TurnOutcome> {
  const emit = opts.onEntry ?? (() => {});
  const state: ToolState = {
    chess: new Chess(ctx.fen),
    notes: ctx.notes,
    drawOffered: ctx.drawOffered,
  };
  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: turnPrompt(ctx) },
  ];
  const tools = toolSpecs(ctx.drawOffered);
  let illegalMoves = 0;

  for (let call = 0; call < (opts.maxCalls ?? 6); call++) {
    const res = await llm.complete({
      model: player.model,
      messages,
      tools,
      reasoning: player.reasoning,
      signal: opts.signal,
    });
    opts.onUsage?.({ costUsd: res.costUsd, tokens: res.tokens });
    if (res.reasoning) emit({ kind: "reasoning", text: res.reasoning });

    const native = res.toolCalls.length > 0;
    const calls = native
      ? res.toolCalls
      : salvageToolCalls(res.content ?? "").map((c, i) => ({ ...c, id: `text-${i}` }));
    if (res.content) emit({ kind: "text", text: res.content });

    if (!calls.length) {
      messages.push(
        { role: "assistant", content: res.content ?? "" },
        { role: "user", content: NUDGE },
      );
      continue;
    }

    messages.push({
      role: "assistant",
      content: res.content,
      ...(native && {
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: c.arguments },
        })),
      }),
    });
    for (const c of calls) {
      const r = executeTool(c.name, c.arguments, state);
      if (r.illegalMove) illegalMoves++;
      emit({ kind: "tool", name: c.name, args: c.arguments, result: r.result, ok: r.ok });
      if (r.decision)
        return { decision: r.decision, fallback: false, notes: state.notes, illegalMoves };
      messages.push(
        native
          ? { role: "tool", tool_call_id: c.id, content: r.result }
          : { role: "user", content: `Result of ${c.name}: ${r.result}` },
      );
    }
  }

  const move = randomLegalMove(state.chess, opts.rng);
  emit({
    kind: "fallback",
    text: `Out of attempts. The harness played a random move: ${move.san}`,
  });
  return {
    decision: { type: "move", move, offerDraw: false },
    fallback: true,
    notes: state.notes,
    illegalMoves,
  };
}
