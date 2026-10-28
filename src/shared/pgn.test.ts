import { describe, expect, it } from "vitest";
import { toPgn } from "./pgn";
import type { GameSnapshot, MoveRecord } from "./types";

const move = (ply: number, san: string, extra: Partial<MoveRecord> = {}): MoveRecord => ({
  ply,
  color: ply % 2 ? "w" : "b",
  san,
  uci: "",
  fen: "",
  fallback: false,
  analysis: null,
  ...extra,
});

const game: Parameters<typeof toPgn>[0] = {
  createdAt: Date.UTC(2026, 9, 28),
  players: {
    w: { label: "You", config: { kind: "human" } },
    b: { label: 'gpt "nano"', config: { kind: "stockfish", skill: 1 } },
  },
  moves: [
    move(1, "e4"),
    move(2, "f6", { analysis: { class: "mistake", accuracy: 60, winLoss: 12, bestSan: "e5" } }),
    move(3, "Qh5+", { fallback: true }),
  ],
  evals: [null, { score: { cp: 30 }, whiteWin: 53, bestUci: null, bestSan: null }, null, null],
  result: { winner: "w", reason: "resignation" } satisfies GameSnapshot["result"],
};

describe("toPgn", () => {
  it("writes headers, numbered moves, NAGs and eval comments", () => {
    const pgn = toPgn(game);
    expect(pgn).toContain('[Date "2026.10.28"]');
    expect(pgn).toContain(`[Black "gpt 'nano'"]`);
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[Termination "resignation"]');
    expect(pgn).toContain("1. e4 {[%eval 0.30]} f6 $2 2. Qh5+ {random fallback move} 1-0");
  });

  it("marks unfinished games and draws", () => {
    expect(toPgn({ ...game, result: null })).toMatch(/\* \n$|\*\n$/);
    expect(toPgn({ ...game, result: { winner: null, reason: "agreement" } })).toContain("1/2-1/2");
  });
});
