import { Chess } from "chess.js";
import type {
  Color,
  GameSnapshot,
  ModelInfo,
  MoveClass,
  PlayerConfig,
  ResultReason,
} from "../shared/types";

export const BADGES: Record<MoveClass, { icon: string; label: string }> = {
  best: { icon: "★", label: "Best move" },
  excellent: { icon: "!", label: "Excellent" },
  good: { icon: "✓", label: "Good" },
  inaccuracy: { icon: "?!", label: "Inaccuracy" },
  mistake: { icon: "?", label: "Mistake" },
  blunder: { icon: "??", label: "Blunder" },
  forced: { icon: "□", label: "Only move" },
};

export const playerIcon = (cfg: PlayerConfig) =>
  cfg.kind === "human" ? "🧑" : cfg.kind === "llm" ? "🤖" : "🐟";

const REASONS: Record<ResultReason, string> = {
  checkmate: "by checkmate",
  resignation: "by resignation",
  stalemate: "by stalemate",
  threefold: "by threefold repetition",
  insufficient: "by insufficient material",
  fifty_moves: "by the 50-move rule",
  agreement: "by agreement",
  move_limit: "at the move limit",
};

export function resultText(game: GameSnapshot): { title: string; detail: string } {
  const r = game.result;
  if (!r) return { title: "In progress", detail: "" };
  if (!r.winner) return { title: "Draw", detail: REASONS[r.reason] };
  const label = game.players[r.winner].label;
  return { title: label === "You" ? "You win!" : `${label} wins`, detail: REASONS[r.reason] };
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;
}

/** Rough cost of a 40-move game: ~1.6k prompt and ~0.3k completion tokens per turn. */
export function estimateGameCost(m: ModelInfo, reasoning: boolean): number {
  const completion = reasoning ? 1500 : 300;
  return (40 * (1600 * m.promptPrice + completion * m.completionPrice)) / 1e6;
}

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const GLYPHS: Record<string, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" };

/** Pieces each side has captured, and its material lead. */
export function captures(fen: string): Record<Color, { pieces: string; lead: number }> {
  const count: Record<Color, Record<string, number>> = { w: {}, b: {} };
  for (const p of new Chess(fen).board().flat())
    if (p) count[p.color][p.type] = (count[p.color][p.type] ?? 0) + 1;
  const taken = (victim: Color) =>
    Object.keys(VALUES).map((t) => ({
      t,
      n: Math.max(0, START_COUNT[t]! - (count[victim][t] ?? 0)),
    }));
  const material = (c: Color) =>
    Object.entries(count[c]).reduce((s, [t, n]) => s + (VALUES[t] ?? 0) * n, 0);
  const diff = material("w") - material("b");
  const describe = (victim: Color) =>
    taken(victim)
      .map(({ t, n }) => GLYPHS[t]!.repeat(n))
      .join("");
  return {
    w: { pieces: describe("b"), lead: Math.max(0, diff) },
    b: { pieces: describe("w"), lead: Math.max(0, -diff) },
  };
}
