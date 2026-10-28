import type { Chess, Move } from "chess.js";
import { playMove } from "../chess/moves";
import type { ToolSpec } from "../llm/types";
import { NOTES_LIMIT } from "./prompt";

export type TurnDecision =
  | { type: "move"; move: Move; say?: string; offerDraw: boolean }
  | { type: "resign"; say?: string }
  | { type: "accept_draw"; say?: string };

export interface ToolState {
  chess: Chess;
  notes: string;
  drawOffered: boolean;
}

export interface ToolResult {
  ok: boolean;
  result: string;
  decision?: TurnDecision;
  illegalMove?: boolean;
}

const say = {
  type: "string",
  description: "Optional short message shown to your opponent.",
} as const;

const SPECS: Record<string, ToolSpec> = {
  make_move: {
    name: "make_move",
    description: "Play your move. This ends your turn.",
    parameters: {
      type: "object",
      properties: {
        move: { type: "string", description: "SAN (Nf3, exd5, O-O, e8=Q) or UCI (g1f3)." },
        say,
        offer_draw: { type: "boolean", description: "Also offer your opponent a draw." },
      },
      required: ["move"],
    },
  },
  write_notes: {
    name: "write_notes",
    description: `Replace your private notebook (max ${NOTES_LIMIT} chars). It is shown to you every turn; nothing else is remembered. Does not end your turn.`,
    parameters: {
      type: "object",
      properties: { notes: { type: "string" } },
      required: ["notes"],
    },
  },
  resign: {
    name: "resign",
    description: "Resign the game. Only when the position is truly hopeless.",
    parameters: { type: "object", properties: { say } },
  },
  accept_draw: {
    name: "accept_draw",
    description: "Accept your opponent's pending draw offer. This ends the game.",
    parameters: { type: "object", properties: { say } },
  },
};

export const TOOL_NAMES = Object.keys(SPECS);

export function toolSpecs(drawOffered: boolean): ToolSpec[] {
  return Object.values(SPECS).filter((s) => drawOffered || s.name !== "accept_draw");
}

const clip = (s: unknown, max: number) =>
  typeof s === "string" && s.trim() ? s.trim().slice(0, max) : undefined;

export function executeTool(name: string, rawArgs: string, state: ToolState): ToolResult {
  let args: Record<string, unknown>;
  try {
    args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    if (typeof args !== "object" || args === null) throw new Error();
  } catch {
    return {
      ok: false,
      result: `Error: arguments must be a JSON object, got ${rawArgs.slice(0, 100)}`,
    };
  }
  const message = clip(args.say, 280);

  switch (name) {
    case "make_move": {
      if (typeof args.move !== "string") return { ok: false, result: 'Error: "move" is required.' };
      const move = playMove(state.chess, args.move);
      if (!move) {
        const check = state.chess.inCheck() ? " You are in check." : "";
        return {
          ok: false,
          illegalMove: true,
          result: `Illegal move "${args.move}".${check} Legal moves: ${state.chess.moves().join(" ")}`,
        };
      }
      return {
        ok: true,
        result: `Played ${move.san}.`,
        decision: { type: "move", move, say: message, offerDraw: args.offer_draw === true },
      };
    }
    case "write_notes": {
      if (typeof args.notes !== "string")
        return { ok: false, result: 'Error: "notes" is required.' };
      state.notes = args.notes.slice(0, NOTES_LIMIT);
      const cut = args.notes.length > NOTES_LIMIT ? ` (truncated to ${NOTES_LIMIT} chars)` : "";
      return { ok: true, result: `Notes saved${cut}. Now make your move.` };
    }
    case "resign":
      return { ok: true, result: "You resigned.", decision: { type: "resign", say: message } };
    case "accept_draw":
      if (!state.drawOffered)
        return { ok: false, result: "Error: there is no draw offer to accept." };
      return {
        ok: true,
        result: "Draw accepted.",
        decision: { type: "accept_draw", say: message },
      };
    default:
      return {
        ok: false,
        result: `Error: unknown tool "${name}". Use one of: ${TOOL_NAMES.join(", ")}.`,
      };
  }
}

/**
 * Some cheap models write tool calls as JSON in plain text instead of using
 * the tools API. Recover `{"name": "...", "arguments": {...}}` objects.
 */
export function salvageToolCalls(text: string): { name: string; arguments: string }[] {
  const calls: { name: string; arguments: string }[] = [];
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>;
          const name = obj.name ?? obj.tool;
          const args = obj.arguments ?? obj.parameters ?? obj.args;
          if (typeof name === "string" && TOOL_NAMES.includes(name)) {
            calls.push({
              name,
              arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
            });
            start = i;
          }
        } catch {
          // not JSON, keep scanning
        }
        break;
      }
    }
  }
  return calls;
}
