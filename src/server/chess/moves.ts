import { Chess, type Move } from "chess.js";

/** Strip the decorations LLMs like to add: "12...", "Nf3+!", "0-0", quotes. */
export function normalizeMoveText(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/^\d+\s*\.+\s*/, "")
    .replace(/[!?]+$/, "")
    .replace(/^0-0-0/, "O-O-O")
    .replace(/^0-0/, "O-O")
    .trim();
}

/**
 * Play a SAN or UCI move on `chess`. Returns the move, or null if illegal.
 * A UCI promotion without a piece ("e7e8") promotes to a queen.
 */
export function playMove(chess: Chess, raw: string): Move | null {
  const text = normalizeMoveText(raw);
  // Coordinates go through the object form: chess.js would otherwise pick an
  // arbitrary piece for "e7e8".
  const uci = /^([a-h][1-8])-?([a-h][1-8])([qrbn])?$/i.exec(text);
  try {
    return uci
      ? chess.move({
          from: uci[1]!.toLowerCase(),
          to: uci[2]!.toLowerCase(),
          promotion: uci[3]?.toLowerCase() ?? "q",
        })
      : chess.move(text);
  } catch {
    return null;
  }
}

export function uciToSan(fen: string, uci: string): string | null {
  return playMove(new Chess(fen), uci)?.san ?? null;
}

export function randomLegalMove(chess: Chess, rng = Math.random): Move {
  const moves = chess.moves({ verbose: true });
  if (!moves.length) throw new Error("No legal moves");
  return moves[Math.floor(rng() * moves.length)]!;
}
