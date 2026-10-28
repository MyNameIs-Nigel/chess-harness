export type Color = "w" | "b";

export const opposite = (c: Color): Color => (c === "w" ? "b" : "w");
export const colorName = (c: Color) => (c === "w" ? "White" : "Black");

export type PersonaId = "coach" | "trash_talker" | "grandmaster" | "nervous" | "pirate" | "silent";
export type ReasoningEffort = "low" | "medium" | "high";

export type HumanPlayer = { kind: "human"; name?: string };
export type LlmPlayer = {
  kind: "llm";
  model: string;
  persona: PersonaId;
  /** Put the legal-move list in every prompt ("training wheels"). */
  showLegalMoves: boolean;
  reasoning?: ReasoningEffort;
};
export type StockfishPlayer = { kind: "stockfish"; skill: number };
export type PlayerConfig = HumanPlayer | LlmPlayer | StockfishPlayer;

/** White's point of view. `mate: 0` means the side to move is checkmated. */
export type Score = { cp: number } | { mate: number };

export interface PositionEval {
  score: Score;
  /** White's winning chances, 0..100. */
  whiteWin: number;
  bestUci: string | null;
  bestSan: string | null;
}

export type MoveClass =
  "best" | "excellent" | "good" | "inaccuracy" | "mistake" | "blunder" | "forced";

export interface MoveAnalysis {
  class: MoveClass;
  accuracy: number;
  /** Win% the mover gave away. */
  winLoss: number;
  bestSan: string | null;
}

export interface MoveRecord {
  ply: number;
  color: Color;
  san: string;
  uci: string;
  /** Position after the move. */
  fen: string;
  /** The harness played a random move because the AI failed to. */
  fallback: boolean;
  analysis: MoveAnalysis | null;
}

export interface ChatMessage {
  color: Color;
  text: string;
  ply: number;
}

export type MindEntry =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; args: string; result: string; ok: boolean }
  | { kind: "fallback"; text: string }
  | { kind: "error"; text: string };

/** One AI turn, as seen from inside its head. */
export interface AiTurn {
  ply: number;
  color: Color;
  entries: MindEntry[];
  done: boolean;
}

export interface SideStats {
  illegalMoves: number;
  fallbacks: number;
  hints: number;
  costUsd: number;
  tokens: number;
}

export type ResultReason =
  | "checkmate"
  | "resignation"
  | "stalemate"
  | "threefold"
  | "insufficient"
  | "fifty_moves"
  | "agreement"
  | "move_limit";

export interface GameResult {
  winner: Color | null;
  reason: ResultReason;
}

export interface PlayerInfo {
  config: PlayerConfig;
  label: string;
}

export interface GameSnapshot {
  id: string;
  players: Record<Color, PlayerInfo>;
  fen: string;
  turn: Color;
  moves: MoveRecord[];
  /** Indexed by ply: evals[0] is the start position. */
  evals: (PositionEval | null)[];
  status: "playing" | "over";
  result: GameResult | null;
  thinking: Color | null;
  drawOffer: Color | null;
  notes: Record<Color, string>;
  chat: ChatMessage[];
  /** Most recent AI turns only. */
  mind: AiTurn[];
  stats: Record<Color, SideStats>;
  error: string | null;
  createdAt: number;
}

export type Action =
  | { type: "move"; move: string }
  | { type: "resign" }
  | { type: "offer_draw" }
  | { type: "accept_draw" }
  | { type: "decline_draw" }
  | { type: "chat"; text: string }
  | { type: "hint" }
  | { type: "retry" };

export interface Hint {
  uci: string;
  san: string;
}

export interface ActionResponse {
  snapshot: GameSnapshot;
  hint?: Hint;
}

export interface ModelInfo {
  id: string;
  name: string;
  /** USD per million tokens. */
  promptPrice: number;
  completionPrice: number;
  reasoning: boolean;
}

export interface Health {
  openrouter: boolean;
  stockfish: boolean;
}
