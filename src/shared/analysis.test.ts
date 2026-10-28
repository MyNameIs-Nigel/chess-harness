import { describe, expect, it } from "vitest";
import { analyzeMove, classify, formatScore, moveAccuracy, summarize, winPercent } from "./analysis";
import type { MoveRecord, PositionEval } from "./types";

const evalOf = (whiteWin: number, bestUci = "e2e4"): PositionEval => ({
  score: { cp: 0 },
  whiteWin,
  bestUci,
  bestSan: "e4",
});

describe("winPercent", () => {
  it("is 50 for an equal position and symmetric around it", () => {
    expect(winPercent({ cp: 0 })).toBe(50);
    expect(winPercent({ cp: 300 }) + winPercent({ cp: -300 })).toBeCloseTo(100);
    expect(winPercent({ cp: 300 })).toBeGreaterThan(75);
  });

  it("clamps huge evals and treats mates as certain", () => {
    expect(winPercent({ cp: 5000 })).toBe(winPercent({ cp: 1000 }));
    expect(winPercent({ mate: 3 })).toBe(100);
    expect(winPercent({ mate: -2 })).toBe(0);
    expect(winPercent({ mate: 0 })).toBe(0); // side to move is mated
  });
});

describe("moveAccuracy", () => {
  it("is ~100 for no loss and falls as the loss grows", () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0);
    expect(moveAccuracy(10)).toBeLessThan(moveAccuracy(5));
    expect(moveAccuracy(100)).toBe(0);
  });
});

describe("classify", () => {
  it.each([
    [0.5, "excellent"],
    [3, "good"],
    [7, "inaccuracy"],
    [15, "mistake"],
    [25, "blunder"],
  ] as const)("a %s%% loss is %s", (loss, expected) => {
    expect(classify(loss, false, false)).toBe(expected);
  });

  it("prefers forced over best over loss buckets", () => {
    expect(classify(30, true, true)).toBe("forced");
    expect(classify(30, true, false)).toBe("best");
  });
});

describe("analyzeMove", () => {
  it("measures loss from the mover's side", () => {
    // Black moves, White's chances jump from 50% to 80%: Black lost 30 points.
    const a = analyzeMove({ color: "b", uci: "d7d5" }, evalOf(50), evalOf(80), 20);
    expect(a.winLoss).toBeCloseTo(30);
    expect(a.class).toBe("blunder");
    expect(a.bestSan).toBe("e4");
  });

  it("gives the engine's move full marks", () => {
    const a = analyzeMove({ color: "w", uci: "e2e4" }, evalOf(55), evalOf(54), 20);
    expect(a).toMatchObject({ class: "best", accuracy: 100 });
  });

  it("never reports negative loss when the opponent's eval was pessimistic", () => {
    expect(analyzeMove({ color: "w", uci: "a2a3" }, evalOf(40), evalOf(60), 20).winLoss).toBe(0);
  });
});

describe("summarize", () => {
  it("averages accuracy and counts badges per side", () => {
    const mk = (color: "w" | "b", cls: "best" | "blunder", accuracy: number) =>
      ({ color, analysis: { class: cls, accuracy, winLoss: 0, bestSan: null } }) as MoveRecord;
    const moves = [mk("w", "best", 100), mk("b", "blunder", 10), mk("w", "blunder", 50)];
    const w = summarize(moves, "w");
    expect(w.accuracy).toBe(75);
    expect(w.counts).toMatchObject({ best: 1, blunder: 1, mistake: 0 });
    expect(summarize([], "b").accuracy).toBeNull();
  });
});

describe("formatScore", () => {
  it.each([
    [{ cp: 125 }, "+1.25"],
    [{ cp: -40 }, "-0.40"],
    [{ cp: 0 }, "0.00"],
    [{ mate: 3 }, "M3"],
    [{ mate: -2 }, "-M2"],
    [{ mate: 0 }, "#"],
  ])("%j → %s", (score, text) => expect(formatScore(score)).toBe(text));
});
