import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { normalizeMoveText, playMove, randomLegalMove, uciToSan } from "./moves";

describe("normalizeMoveText", () => {
  it.each([
    ["1. e4", "e4"],
    ["12...Nf6", "Nf6"],
    ["Nf3!?", "Nf3"],
    ['"Bb5"', "Bb5"],
    ["0-0", "O-O"],
    ["0-0-0", "O-O-O"],
    [" Qxd7+. ", "Qxd7+"],
  ])("%s → %s", (raw, expected) => expect(normalizeMoveText(raw)).toBe(expected));
});

describe("playMove", () => {
  it("accepts SAN, UCI and dashed coordinates", () => {
    expect(playMove(new Chess(), "Nf3")?.san).toBe("Nf3");
    expect(playMove(new Chess(), "g1f3")?.san).toBe("Nf3");
    expect(playMove(new Chess(), "e2-e4")?.san).toBe("e4");
    expect(playMove(new Chess(), "1. e4")?.san).toBe("e4");
  });

  it("promotes to a queen when UCI omits the piece", () => {
    const chess = new Chess("8/P7/8/8/8/8/8/k6K w - - 0 1");
    expect(playMove(chess, "a7a8")?.san).toBe("a8=Q+");
    expect(playMove(new Chess("8/P7/8/8/8/8/8/k6K w - - 0 1"), "a7a8n")?.san).toBe("a8=N");
  });

  it("returns null without touching the board for illegal or garbage input", () => {
    const chess = new Chess();
    for (const bad of ["Qxh9", "e5", "e2e5", "", "hello"]) expect(playMove(chess, bad)).toBeNull();
    expect(chess.history()).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("converts UCI to SAN for a position", () => {
    expect(uciToSan(new Chess().fen(), "b1c3")).toBe("Nc3");
    expect(uciToSan(new Chess().fen(), "b1b3")).toBeNull();
  });

  it("picks a legal move", () => {
    const chess = new Chess();
    const legal = chess.moves();
    for (const r of [0, 0.5, 0.999]) expect(legal).toContain(randomLegalMove(chess, () => r).san);
  });
});
