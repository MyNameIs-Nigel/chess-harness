import type { Color, MoveAnalysis, MoveClass, MoveRecord, PositionEval, Score } from "./types";

/** Lichess win% model: centipawns (side-to-move POV) → winning chances 0..100. */
export function winPercent(score: Score): number {
  if ("mate" in score) return score.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Lichess per-move accuracy from the win% the mover lost. */
export function moveAccuracy(winLoss: number): number {
  const acc = 103.1668 * Math.exp(-0.04354 * Math.max(0, winLoss)) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

/** Upper bounds (exclusive) of win% lost for each badge. Anything above is a blunder. */
const THRESHOLDS: [MoveClass, number][] = [
  ["excellent", 2],
  ["good", 5],
  ["inaccuracy", 10],
  ["mistake", 20],
];

export function classify(winLoss: number, isBest: boolean, isForced: boolean): MoveClass {
  if (isForced) return "forced";
  if (isBest) return "best";
  return THRESHOLDS.find(([, max]) => winLoss < max)?.[0] ?? "blunder";
}

const moverWin = (e: PositionEval, mover: Color) => (mover === "w" ? e.whiteWin : 100 - e.whiteWin);

export function analyzeMove(
  move: Pick<MoveRecord, "color" | "uci">,
  before: PositionEval,
  after: PositionEval,
  legalMoveCount: number,
): MoveAnalysis {
  const winLoss = Math.max(0, moverWin(before, move.color) - moverWin(after, move.color));
  const isBest = before.bestUci === move.uci;
  return {
    class: classify(winLoss, isBest, legalMoveCount === 1),
    accuracy: isBest ? 100 : moveAccuracy(winLoss),
    winLoss,
    bestSan: before.bestSan,
  };
}

export interface SideSummary {
  accuracy: number | null;
  counts: Record<MoveClass, number>;
}

export function summarize(moves: MoveRecord[], color: Color): SideSummary {
  const counts = Object.fromEntries(
    (["best", "excellent", "good", "inaccuracy", "mistake", "blunder", "forced"] as const).map(
      (c) => [c, 0],
    ),
  ) as Record<MoveClass, number>;
  const accs: number[] = [];
  for (const m of moves) {
    if (m.color !== color || !m.analysis) continue;
    counts[m.analysis.class]++;
    accs.push(m.analysis.accuracy);
  }
  const accuracy = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null;
  return { accuracy, counts };
}

/** "+1.25", "-0.40", "M3", "-M2", or "#" for a mated position. */
export function formatScore(score: Score): string {
  if ("mate" in score) {
    if (score.mate === 0) return "#";
    return score.mate > 0 ? `M${score.mate}` : `-M${-score.mate}`;
  }
  const pawns = score.cp / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}
