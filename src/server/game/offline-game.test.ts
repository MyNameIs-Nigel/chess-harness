import { afterAll, expect, it } from "vitest";
import { StockfishAnalyzer, startEnginePlayer } from "../engine/stockfish";
import { RandomMoverClient } from "../llm/random-mover";
import { waitFor } from "../test/fakes";
import { GameStore } from "./store";

// Everything real except the LLM: the random mover speaks the same tool protocol.
const analyzer = new StockfishAnalyzer(undefined, 8);
afterAll(() => analyzer.quit());

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

it("plays a full offline game with real Stockfish grading every move", async () => {
  const store = new GameStore({
    llm: new RandomMoverClient({ rng: seeded(7), delayMs: 0 }),
    analyzer,
    startEnginePlayer: (skill) => startEnginePlayer(skill),
    maxPlies: 40,
  });
  const game = store.create({
    w: { kind: "llm", model: "local/random-mover", persona: "silent", showLegalMoves: true },
    b: { kind: "stockfish", skill: 5 },
  });

  const end = await waitFor(
    game,
    (s) => s.status === "over" && s.moves.every((m) => m.analysis),
    30_000,
  );
  game.dispose();

  expect(end.result).not.toBeNull();
  expect(end.moves.length).toBeGreaterThan(4);
  expect(end.evals.slice(0, end.moves.length + 1).every(Boolean)).toBe(true);
  expect(
    end.moves.filter((m) => m.color === "w" && m.analysis?.class === "blunder").length,
  ).toBeGreaterThan(0);
  const toolCalls = end.mind.flatMap((t) => t.entries).filter((e) => e.kind === "tool");
  expect(toolCalls.some((e) => e.name === "make_move" && e.ok)).toBe(true);
}, 40_000);
