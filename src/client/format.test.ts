import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "../shared/types";
import { captures, estimateGameCost, formatUsd, resultText } from "./format";

describe("captures", () => {
  it("is empty at the start", () => {
    expect(captures("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toEqual({
      w: { pieces: "", lead: 0 },
      b: { pieces: "", lead: 0 },
    });
  });

  it("lists captured pieces and the material lead", () => {
    // White has taken a knight; Black has taken a pawn.
    const c = captures("r1bqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR w KQkq - 0 1");
    expect(c.w).toEqual({ pieces: "♞", lead: 2 });
    expect(c.b).toEqual({ pieces: "♟", lead: 0 });
  });
});

describe("resultText", () => {
  const game = (result: GameSnapshot["result"]) =>
    ({
      result,
      players: {
        w: { label: "You", config: { kind: "human" } },
        b: { label: "gpt-5-nano", config: { kind: "human" } },
      },
    }) as GameSnapshot;

  it("celebrates the human and names the AI", () => {
    expect(resultText(game({ winner: "w", reason: "checkmate" }))).toEqual({
      title: "You win!",
      detail: "by checkmate",
    });
    expect(resultText(game({ winner: "b", reason: "resignation" })).title).toBe("gpt-5-nano wins");
    expect(resultText(game({ winner: null, reason: "threefold" }))).toEqual({
      title: "Draw",
      detail: "by threefold repetition",
    });
  });
});

describe("costs", () => {
  it("estimates a game and formats tiny amounts", () => {
    const cheap = { id: "x", name: "x", promptPrice: 0.1, completionPrice: 0.4, reasoning: false };
    expect(estimateGameCost(cheap, false)).toBeCloseTo(0.0112);
    expect(estimateGameCost(cheap, true)).toBeGreaterThan(estimateGameCost(cheap, false));
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.00123)).toBe("$0.0012");
    expect(formatUsd(0.5)).toBe("$0.500");
  });
});
