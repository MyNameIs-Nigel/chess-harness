import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type { LlmPlayer, MindEntry } from "../../shared/types";
import { call, move, ScriptedLlm } from "../test/fakes";
import { playLlmTurn } from "./agent";
import { turnPrompt, type TurnContext } from "./prompt";
import { salvageToolCalls, toolSpecs } from "./tools";

const player: LlmPlayer = {
  kind: "llm",
  model: "test/model",
  persona: "pirate",
  showLegalMoves: false,
};

function ctx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    fen: new Chess().fen(),
    color: "w",
    history: [],
    notes: "",
    opponentMessages: [],
    drawOffered: false,
    opponentLabel: "a human player",
    persona: "pirate",
    showLegalMoves: false,
    ...overrides,
  };
}

async function turn(llm: ScriptedLlm, c = ctx(), maxCalls = 6) {
  const entries: MindEntry[] = [];
  const usage = { costUsd: 0, tokens: 0 };
  const outcome = await playLlmTurn(llm, player, c, {
    maxCalls,
    onEntry: (e) => entries.push(e),
    onUsage: (u) => ((usage.costUsd += u.costUsd), (usage.tokens += u.tokens)),
    rng: () => 0,
  });
  return { outcome, entries, usage };
}

describe("playLlmTurn", () => {
  it("plays a legal move on the first try", async () => {
    const llm = new ScriptedLlm([move("e4", { say: "Arr!", offer_draw: true })]);
    const { outcome, usage } = await turn(llm);
    expect(outcome.decision).toMatchObject({ type: "move", say: "Arr!", offerDraw: true });
    expect(outcome.decision.type === "move" && outcome.decision.move.san).toBe("e4");
    expect(outcome).toMatchObject({ fallback: false, illegalMoves: 0 });
    expect(usage).toEqual({ costUsd: 0.001, tokens: 100 });
    expect(llm.requests[0]).toMatchObject({ model: "test/model" });
    expect(llm.requests[0]!.messages[0]).toMatchObject({ role: "system" });
  });

  it("keeps notes written before the move, even in the same response", async () => {
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: "a", name: "write_notes", arguments: '{"notes":"plan: castle"}' },
          { id: "b", name: "make_move", arguments: '{"move":"Nf3"}' },
        ],
      },
    ]);
    const { outcome, entries } = await turn(llm);
    expect(outcome.notes).toBe("plan: castle");
    expect(entries.map((e) => e.kind === "tool" && e.name)).toEqual(["write_notes", "make_move"]);
  });

  it("explains illegal moves with the legal list so the model can recover", async () => {
    const llm = new ScriptedLlm([move("Qxh7"), move("d4")]);
    const { outcome, entries } = await turn(llm);
    expect(outcome.illegalMoves).toBe(1);
    expect(outcome.decision.type === "move" && outcome.decision.move.san).toBe("d4");
    const retry = llm.requests[1]!.messages;
    expect(retry.at(-2)).toMatchObject({
      role: "assistant",
      tool_calls: [{ function: { name: "make_move" } }],
    });
    expect(retry.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("Legal moves: a3 a4"),
    });
    expect(entries[0]).toMatchObject({ kind: "tool", ok: false });
  });

  it("nudges a model that answers in prose", async () => {
    const llm = new ScriptedLlm([{ content: "I think e4 is good." }, move("e4")]);
    const { outcome, entries } = await turn(llm);
    expect(outcome.decision.type).toBe("move");
    expect(llm.requests[1]!.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("did not call a tool"),
    });
    expect(entries[0]).toEqual({ kind: "text", text: "I think e4 is good." });
  });

  it("salvages tool calls written as JSON text", async () => {
    const llm = new ScriptedLlm([
      { content: 'Sure! {"name": "make_move", "arguments": {"move": "c4"}}' },
    ]);
    const { outcome } = await turn(llm);
    expect(outcome.decision.type === "move" && outcome.decision.move.san).toBe("c4");
  });

  it("reports reasoning text", async () => {
    const { entries } = await turn(
      new ScriptedLlm([{ reasoning: "e4 controls the centre", ...move("e4") }]),
    );
    expect(entries[0]).toEqual({ kind: "reasoning", text: "e4 controls the centre" });
  });

  it("plays a random legal move once the call budget runs out", async () => {
    const llm = new ScriptedLlm([move("Ke5"), { content: "hmm" }, call("make_move", { move: 42 })]);
    const { outcome, entries } = await turn(llm, ctx(), 3);
    expect(llm.requests).toHaveLength(3);
    expect(outcome.fallback).toBe(true);
    expect(outcome.decision.type === "move" && outcome.decision.move.san).toBe("a3");
    expect(entries.at(-1)).toMatchObject({ kind: "fallback" });
  });

  it("resigns, and accepts draws only when one is offered", async () => {
    expect((await turn(new ScriptedLlm([call("resign", { say: "gg" })]))).outcome.decision).toEqual(
      { type: "resign", say: "gg" },
    );

    const refused = new ScriptedLlm([call("accept_draw"), move("e4")]);
    await turn(refused);
    expect(refused.requests[0]!.tools.map((t) => t.name)).not.toContain("accept_draw");
    expect(refused.requests[1]!.messages.at(-1)).toMatchObject({
      content: expect.stringContaining("no draw offer"),
    });

    const offered = new ScriptedLlm([call("accept_draw")]);
    const { outcome } = await turn(offered, ctx({ drawOffered: true }));
    expect(outcome.decision.type).toBe("accept_draw");
    expect(offered.requests[0]!.tools.map((t) => t.name)).toContain("accept_draw");
  });

  it("rejects malformed arguments without crashing", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: "x", name: "make_move", arguments: "{oops" }] },
      move("e4"),
    ]);
    const { entries } = await turn(llm);
    expect(entries[0]).toMatchObject({ ok: false, result: expect.stringContaining("JSON") });
  });

  it("propagates API errors to the caller", async () => {
    await expect(turn(new ScriptedLlm([new Error("402 out of credits")]))).rejects.toThrow(
      "out of credits",
    );
  });
});

describe("turnPrompt", () => {
  it("shows the board, pieces, history and an empty notebook", () => {
    const text = turnPrompt(
      ctx({
        fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        history: ["e4", "e5"],
      }),
    );
    expect(text).toContain("Move 2. You are White");
    expect(text).toContain("Black just played e5.");
    expect(text).toContain("FEN: rnbqkbnr/pppp1ppp");
    expect(text).toContain("White pieces: Ke1 Qd1 Ra1 Rh1");
    expect(text).toContain("Moves so far: 1. e4 e5");
    expect(text).toContain("(empty)");
    expect(text).not.toContain("legal moves");
  });

  it("adds check, draw offers, chat, notes and legal moves when relevant", () => {
    const text = turnPrompt(
      ctx({
        fen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
        drawOffered: true,
        opponentMessages: ["nice try"],
        notes: "watch h4",
        showLegalMoves: true,
      }),
    );
    expect(text).toContain("CHECK");
    expect(text).toContain("offers a draw");
    expect(text).toContain('Black says: "nice try"');
    expect(text).toContain("watch h4");
    expect(text).toContain("Your legal moves:");
  });
});

describe("tools", () => {
  it("salvages only known tools from text", () => {
    expect(
      salvageToolCalls('{"name":"make_move","arguments":{"move":"e4"}} and {"name":"hack"}'),
    ).toEqual([{ name: "make_move", arguments: '{"move":"e4"}' }]);
    expect(salvageToolCalls('{"tool":"resign","args":"{}"}')).toEqual([
      { name: "resign", arguments: "{}" },
    ]);
    expect(salvageToolCalls("no json { here")).toEqual([]);
  });

  it("exposes a tiny toolset", () => {
    expect(toolSpecs(false).map((t) => t.name)).toEqual(["make_move", "write_notes", "resign"]);
  });
});
