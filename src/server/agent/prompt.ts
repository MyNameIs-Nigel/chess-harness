import { Chess } from "chess.js";
import { PERSONAS } from "../../shared/personas";
import { colorName, opposite, type Color, type PersonaId } from "../../shared/types";

export interface TurnContext {
  fen: string;
  color: Color;
  /** SAN moves played so far, from the start position. */
  history: string[];
  notes: string;
  /** Chat from the opponent since this side last moved. */
  opponentMessages: string[];
  drawOffered: boolean;
  opponentLabel: string;
  persona: PersonaId;
  showLegalMoves: boolean;
}

export const NOTES_LIMIT = 2000;

export function systemPrompt(ctx: Pick<TurnContext, "color" | "opponentLabel" | "persona">) {
  return `You are playing chess as ${colorName(ctx.color)} against ${ctx.opponentLabel}.
${PERSONAS[ctx.persona].style} Your persona only changes how you talk: always play the strongest chess you can.

How this works:
- Each turn you are shown the position, the move history and your private notebook. You remember nothing else between turns, so use write_notes to keep plans and observations (max ${NOTES_LIMIT} characters, it replaces the old notes).
- End your turn with make_move, resign or accept_draw. Moves are SAN (Nf3, exd5, O-O, e8=Q) or UCI (g1f3).
- Illegal moves are rejected and you may retry, but repeated failures make the harness play a random move for you.
- \`say\` is shown to your opponent. Keep it under 25 words.

Before moving, check which of your pieces are attacked, and look for checks, captures and threats on both sides.`;
}

function pieceList(chess: Chess, color: Color): string {
  const order = "kqrbnp";
  return chess
    .board()
    .flat()
    .filter((p) => p?.color === color)
    .sort((a, b) => order.indexOf(a!.type) - order.indexOf(b!.type))
    .map((p) => `${p!.type === "p" ? "" : p!.type.toUpperCase()}${p!.square}`)
    .join(" ");
}

export function moveList(history: string[]): string {
  if (!history.length) return "(none, this is the first move)";
  return history.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(" ");
}

export function turnPrompt(ctx: TurnContext): string {
  const chess = new Chess(ctx.fen);
  const me = colorName(ctx.color);
  const them = colorName(opposite(ctx.color));
  const lines = [`Move ${chess.moveNumber()}. You are ${me} and it is your move.`];
  const last = ctx.history.at(-1);
  if (last) lines.push(`${them} just played ${last}.`);
  if (chess.inCheck()) lines.push("You are in CHECK.");
  if (ctx.drawOffered) {
    lines.push(`${them} offers a draw. Call accept_draw to accept, or make a move to decline.`);
  }
  for (const msg of ctx.opponentMessages) lines.push(`${them} says: "${msg}"`);
  lines.push(
    "",
    "Board (White at the bottom, uppercase = White):",
    chess.ascii(),
    `FEN: ${ctx.fen}`,
    `White pieces: ${pieceList(chess, "w")}`,
    `Black pieces: ${pieceList(chess, "b")}`,
    `Moves so far: ${moveList(ctx.history)}`,
  );
  if (ctx.showLegalMoves) lines.push(`Your legal moves: ${chess.moves().join(" ")}`);
  lines.push("", "Your notebook:", ctx.notes.trim() || "(empty)");
  return lines.join("\n");
}
