import { afterEach, describe, expect, it } from "vitest";
import type { Color, PlayerConfig } from "../../shared/types";
import { call, deps, fakeEnginePlayer, move, ScriptedLlm, waitFor } from "../test/fakes";
import { ActionError, GameSession, type SessionDeps } from "./session";

const human: PlayerConfig = { kind: "human" };
const llm: PlayerConfig = {
  kind: "llm",
  model: "acme/bot-1",
  persona: "trash_talker",
  showLegalMoves: true,
};

const sessions: GameSession[] = [];
function game(players: Record<Color, PlayerConfig>, overrides: Partial<SessionDeps> = {}) {
  const s = new GameSession("g1", players, deps(overrides));
  sessions.push(s);
  s.start();
  return s;
}
afterEach(() => sessions.splice(0).forEach((s) => s.dispose()));

const plies = (n: number) => (s: { moves: unknown[] }) => s.moves.length >= n;

describe("GameSession: human vs LLM", () => {
  it("answers a human move with an LLM move, keeping notes, mind log and cost", async () => {
    const bot = new ScriptedLlm([
      { reasoning: "mirror them", ...call("write_notes", { notes: "mirror strategy" }) },
      move("e5", { say: "Copycat!" }),
    ]);
    const g = game({ w: human, b: llm }, { llm: bot });
    await g.act({ type: "move", move: "e4" });
    const s = await waitFor(g, (s) => s.moves.length === 2 && s.thinking === null);

    expect(s.moves.map((m) => m.san)).toEqual(["e4", "e5"]);
    expect(s.players.b.label).toBe("bot-1");
    expect(s.notes.b).toBe("mirror strategy");
    expect(s.chat).toEqual([{ color: "b", text: "Copycat!", ply: 2 }]);
    expect(s.mind[0]).toMatchObject({ ply: 2, color: "b", done: true });
    expect(s.mind[0]!.entries.map((e) => e.kind)).toEqual(["reasoning", "tool", "tool"]);
    expect(s.stats.b).toMatchObject({ costUsd: 0.002, tokens: 200, illegalMoves: 0 });
    expect(bot.prompt(0)).toContain("White just played e4.");
    expect(bot.requests[0]!.messages[0]).toMatchObject({
      content: expect.stringContaining("against a human player"),
    });
  });

  it("lets the LLM open as White and grades every move with the analyzer", async () => {
    const g = game({ w: llm, b: human }, { llm: new ScriptedLlm([move("e4")]) });
    await waitFor(g, plies(1));
    await g.act({ type: "move", move: "e5" });
    const s = await waitFor(g, (s) => s.evals.length === 3 && s.evals.every(Boolean));
    expect(s.moves[0]!.analysis).toMatchObject({ class: "excellent", bestSan: "a3" });
    expect(s.moves[1]!.analysis?.accuracy).toBeGreaterThan(90);
  });

  it("delivers human chat to the LLM on its next turn only once", async () => {
    const bot = new ScriptedLlm([move("e5"), move("Nc6")]);
    const g = game({ w: human, b: llm }, { llm: bot });
    await g.act({ type: "chat", text: "prepare to lose" });
    await g.act({ type: "move", move: "e4" });
    await waitFor(g, plies(2));
    await g.act({ type: "move", move: "Nf3" });
    await waitFor(g, plies(4));
    expect(bot.prompt(0)).toContain('White says: "prepare to lose"');
    expect(bot.prompt(1)).not.toContain("prepare to lose");
  });

  it("reminds the LLM of its own last line so the banter stays fresh", async () => {
    const bot = new ScriptedLlm([move("e5", { say: "Arr, nice try" }), move("Nc6")]);
    const g = game({ w: human, b: llm }, { llm: bot });
    await g.act({ type: "move", move: "e4" });
    await waitFor(g, plies(2));
    await g.act({ type: "move", move: "Nf3" });
    await waitFor(g, plies(4));
    expect(bot.prompt(0)).not.toContain("You last said");
    expect(bot.prompt(1)).toContain('You last said: "Arr, nice try"');
  });

  it("rejects illegal, out-of-turn and post-game actions", async () => {
    const g = game({ w: human, b: llm }, { llm: new ScriptedLlm([move("e5")], 50) });
    await expect(g.act({ type: "move", move: "e5" })).rejects.toThrow("Illegal move");
    await g.act({ type: "move", move: "e4" });
    await expect(g.act({ type: "move", move: "d4" })).rejects.toThrow("not your turn");
    await expect(g.act({ type: "accept_draw" })).rejects.toThrow(ActionError);
    await g.act({ type: "resign" });
    await expect(g.act({ type: "chat", text: "hi" })).rejects.toThrow("over");
  });

  it("detects checkmate", async () => {
    const g = game({ w: llm, b: human }, { llm: new ScriptedLlm([move("f3"), move("g4")]) });
    await waitFor(g, plies(1));
    await g.act({ type: "move", move: "e5" });
    await waitFor(g, plies(3));
    await g.act({ type: "move", move: "Qh4#" });
    const s = g.snapshot();
    expect(s.status).toBe("over");
    expect(s.result).toEqual({ winner: "b", reason: "checkmate" });
  });

  it("ignores a late AI move after the human resigns mid-thought", async () => {
    const g = game({ w: human, b: llm }, { llm: new ScriptedLlm([move("e5")], 100) });
    await g.act({ type: "move", move: "e4" });
    await g.act({ type: "resign" });
    await new Promise((r) => setTimeout(r, 150));
    const s = g.snapshot();
    expect(s.result).toEqual({ winner: "b", reason: "resignation" });
    expect(s.moves).toHaveLength(1);
    expect(s.thinking).toBeNull();
  });

  it("pauses on API errors and resumes on retry", async () => {
    const bot = new ScriptedLlm([new Error("upstream 503")]);
    const g = game({ w: human, b: llm }, { llm: bot });
    await g.act({ type: "move", move: "e4" });
    const failed = await waitFor(g, (s) => s.error !== null);
    expect(failed.error).toBe("bot-1: upstream 503");
    expect(failed.thinking).toBeNull();
    expect(failed.mind[0]!.entries.at(-1)).toEqual({ kind: "error", text: "upstream 503" });

    bot.push(move("e5"));
    await g.act({ type: "retry" });
    const s = await waitFor(g, plies(2));
    expect(s.error).toBeNull();
  });

  it("counts fallbacks and illegal attempts against a confused model", async () => {
    const bot = new ScriptedLlm([move("Qxh9"), move("Ke7"), { content: "?" }]);
    const g = game({ w: human, b: llm }, { llm: bot, maxCallsPerTurn: 3 });
    await g.act({ type: "move", move: "e4" });
    const s = await waitFor(g, plies(2));
    expect(s.moves[1]!.fallback).toBe(true);
    expect(s.stats.b).toMatchObject({ illegalMoves: 2, fallbacks: 1 });
  });

  it("gives hints from the analyzer and counts them", async () => {
    const g = game({ w: human, b: llm });
    const { hint, snapshot } = await g.act({ type: "hint" });
    expect(hint).toEqual({ uci: "a2a3", san: "a3" });
    expect(snapshot.stats.w.hints).toBe(1);
  });

  it("refuses hints when analysis is disabled", async () => {
    const g = game({ w: human, b: llm }, { analyzer: null });
    await expect(g.act({ type: "hint" })).rejects.toThrow("disabled");
  });
});

describe("GameSession: draws", () => {
  it("shows a human draw offer to the LLM, which can accept", async () => {
    const bot = new ScriptedLlm([call("accept_draw", { say: "fine" })]);
    const g = game({ w: human, b: llm }, { llm: bot });
    await g.act({ type: "offer_draw" });
    await expect(g.act({ type: "offer_draw" })).rejects.toThrow("already pending");
    await g.act({ type: "move", move: "e4" });
    const s = await waitFor(g, (s) => s.status === "over");
    expect(bot.prompt(0)).toContain("offers a draw");
    expect(s.result).toEqual({ winner: null, reason: "agreement" });
    expect(s.chat.at(-1)?.text).toBe("fine");
  });

  it("treats an LLM move as declining the offer it saw", async () => {
    const g = game({ w: human, b: llm }, { llm: new ScriptedLlm([move("e5")]) });
    await g.act({ type: "offer_draw" });
    await g.act({ type: "move", move: "e4" });
    const s = await waitFor(g, plies(2));
    expect(s.drawOffer).toBeNull();
  });

  it("keeps an offer made mid-thought pending for the LLM's next turn", async () => {
    const g = game({ w: human, b: llm }, { llm: new ScriptedLlm([move("e5")], 50) });
    await g.act({ type: "move", move: "e4" });
    await g.act({ type: "offer_draw" });
    const s = await waitFor(g, plies(2));
    expect(s.drawOffer).toBe("w");
  });

  it("lets the human accept or decline an LLM's offer", async () => {
    const bot = new ScriptedLlm([
      move("e5", { offer_draw: true }),
      move("Nc6", { offer_draw: true }),
    ]);
    const g = game({ w: human, b: llm }, { llm: bot });
    await g.act({ type: "move", move: "e4" });
    expect((await waitFor(g, plies(2))).drawOffer).toBe("b");
    await g.act({ type: "decline_draw" });
    expect(g.snapshot().drawOffer).toBeNull();
    await g.act({ type: "move", move: "Nf3" });
    await waitFor(g, (s) => s.drawOffer === "b");
    await g.act({ type: "accept_draw" });
    expect(g.snapshot().result).toEqual({ winner: null, reason: "agreement" });
  });
});

describe("GameSession: other seats", () => {
  it("plays Stockfish moves from the engine player", async () => {
    const skills: number[] = [];
    const g = game(
      { w: human, b: { kind: "stockfish", skill: 3 } },
      { startEnginePlayer: async (skill) => (skills.push(skill), fakeEnginePlayer(["c7c5"])) },
    );
    await g.act({ type: "move", move: "e4" });
    const s = await waitFor(g, plies(2));
    expect(s.moves[1]!.san).toBe("c5");
    expect(s.players.b.label).toBe("Stockfish lvl 3");
    expect(skills).toEqual([3]);
  });

  it("has Stockfish accept a draw only when it is worse", async () => {
    const stockfish: PlayerConfig = { kind: "stockfish", skill: 0 };
    const offerDrawAfterE4 = async (whiteWin: number) => {
      const g = game(
        { w: human, b: stockfish },
        {
          analyzer: {
            evaluate: async () => ({ score: { cp: 0 }, whiteWin, bestUci: null, bestSan: null }),
          },
          startEnginePlayer: async () => fakeEnginePlayer(["e7e5"]),
        },
      );
      await g.act({ type: "offer_draw" });
      await g.act({ type: "move", move: "e4" });
      return waitFor(g, (s) => s.status === "over" || s.moves.length === 2);
    };
    expect((await offerDrawAfterE4(50)).drawOffer).toBeNull(); // level: plays on, declining
    expect((await offerDrawAfterE4(90)).result).toEqual({ winner: null, reason: "agreement" });
  });

  it("runs LLM vs LLM until the move limit", async () => {
    const white = new ScriptedLlm(Array.from({ length: 4 }, (_, i) => move(i % 2 ? "Nb1" : "Nc3")));
    const black = new ScriptedLlm(Array.from({ length: 4 }, (_, i) => move(i % 2 ? "Nb8" : "Nc6")));
    const g = game(
      { w: llm, b: { ...llm, model: "acme/bot-2" } },
      {
        llm: { complete: (req) => (req.model === "acme/bot-1" ? white : black).complete(req) },
        maxPlies: 6,
      },
    );
    const s = await waitFor(g, (s) => s.status === "over");
    expect(s.moves).toHaveLength(6);
    expect(s.result).toEqual({ winner: null, reason: "move_limit" });
    expect(white.requests[0]!.messages[0]).toMatchObject({
      content: expect.stringContaining("another AI (acme/bot-2)"),
    });
  });

  it("rejects human actions when no human is seated", async () => {
    const g = game(
      { w: { kind: "stockfish", skill: 1 }, b: { kind: "stockfish", skill: 1 } },
      {
        startEnginePlayer: async () => fakeEnginePlayer(["e2e4", "e7e5"]),
        maxPlies: 2,
      },
    );
    await expect(g.act({ type: "resign" })).rejects.toThrow("no human");
  });
});
