import type { GameSnapshot, MoveClass, Score } from "./types";

const NAGS: Partial<Record<MoveClass, string>> = { inaccuracy: "$6", mistake: "$2", blunder: "$4" };

function evalComment(score: Score): string {
  if ("mate" in score) return score.mate === 0 ? "" : `[%eval #${score.mate}]`;
  return `[%eval ${(score.cp / 100).toFixed(2)}]`;
}

export function resultTag(s: Pick<GameSnapshot, "result">): string {
  if (!s.result) return "*";
  if (!s.result.winner) return "1/2-1/2";
  return s.result.winner === "w" ? "1-0" : "0-1";
}

/** PGN with Stockfish evals and NAGs, ready to import into Lichess for review. */
export function toPgn(
  s: Pick<GameSnapshot, "players" | "moves" | "evals" | "result" | "createdAt">,
) {
  const date = new Date(s.createdAt).toISOString().slice(0, 10).replaceAll("-", ".");
  const result = resultTag(s);
  const headers = [
    ["Event", "LLM Chess Harness"],
    ["Date", date],
    ["White", s.players.w.label],
    ["Black", s.players.b.label],
    ["Result", result],
    ...(s.result ? [["Termination", s.result.reason]] : []),
  ].map(([k, v]) => `[${k} "${v!.replaceAll('"', "'")}"]`);

  const tokens: string[] = [];
  for (const m of s.moves) {
    if (m.color === "w") tokens.push(`${Math.ceil(m.ply / 2)}.`);
    tokens.push(m.san);
    const nag = m.analysis && NAGS[m.analysis.class];
    if (nag) tokens.push(nag);
    const notes = [
      s.evals[m.ply] ? evalComment(s.evals[m.ply]!.score) : "",
      m.fallback ? "random fallback move" : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (notes) tokens.push(`{${notes}}`);
  }
  tokens.push(result);
  return `${headers.join("\n")}\n\n${tokens.join(" ")}\n`;
}
