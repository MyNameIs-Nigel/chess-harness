import { Chess, type Move } from "chess.js";
import { analyzeMove } from "../../shared/analysis";
import {
  opposite,
  type Action,
  type ActionResponse,
  type AiTurn,
  type ChatMessage,
  type Color,
  type GameResult,
  type GameSnapshot,
  type LlmPlayer,
  type MoveRecord,
  type PlayerConfig,
  type PlayerInfo,
  type PositionEval,
  type SideStats,
  type StockfishPlayer,
} from "../../shared/types";
import { playLlmTurn } from "../agent/agent";
import type { TurnDecision } from "../agent/tools";
import { playMove } from "../chess/moves";
import type { Analyzer, EnginePlayer } from "../engine/stockfish";
import type { LlmClient } from "../llm/types";

export interface SessionDeps {
  llm: LlmClient;
  analyzer: Analyzer | null;
  startEnginePlayer: (skill: number) => Promise<EnginePlayer>;
  /** The game is drawn after this many plies. */
  maxPlies?: number;
  maxCallsPerTurn?: number;
}

/** A rejected human action; maps to HTTP 400. */
export class ActionError extends Error {}

const MIND_HISTORY = 20;
const START_FEN = new Chess().fen();

type AiOutcome = { decision: TurnDecision; fallback: boolean };

const newStats = (): SideStats => ({
  illegalMoves: 0,
  fallbacks: 0,
  hints: 0,
  costUsd: 0,
  tokens: 0,
});

function playerLabel(cfg: PlayerConfig): string {
  switch (cfg.kind) {
    case "human":
      return cfg.name?.trim() || "You";
    case "llm":
      return cfg.model.split("/").pop()!;
    case "stockfish":
      return `Stockfish lvl ${cfg.skill}`;
  }
}

/** How the opponent is introduced to an LLM. */
function describeForPrompt(cfg: PlayerConfig): string {
  switch (cfg.kind) {
    case "human":
      return cfg.name?.trim() || "a human player";
    case "llm":
      return `another AI (${cfg.model})`;
    case "stockfish":
      return `the Stockfish engine at skill level ${cfg.skill} of 20`;
  }
}

/**
 * The single authority for one game: validates actions from every seat, runs
 * AI turns, schedules Stockfish analysis and broadcasts snapshots.
 */
export class GameSession {
  readonly id: string;
  readonly createdAt = Date.now();
  private readonly players: Record<Color, PlayerInfo>;
  private readonly deps: SessionDeps;
  private readonly chess = new Chess();
  private readonly moves: MoveRecord[] = [];
  private readonly evals: (PositionEval | null)[] = [null];
  private readonly evalPromises: Promise<PositionEval | null>[] = [];
  private readonly notes: Record<Color, string> = { w: "", b: "" };
  private readonly chat: ChatMessage[] = [];
  /** Chat each side has not seen yet. */
  private readonly inbox: Record<Color, string[]> = { w: [], b: [] };
  private readonly mind: AiTurn[] = [];
  private readonly stats: Record<Color, SideStats> = { w: newStats(), b: newStats() };
  private readonly enginePlayers: Partial<Record<Color, Promise<EnginePlayer>>> = {};
  private readonly listeners = new Set<(s: GameSnapshot) => void>();
  private readonly abort = new AbortController();
  private result: GameResult | null = null;
  private thinking: Color | null = null;
  private drawOffer: Color | null = null;
  private error: string | null = null;
  private version = 0;

  constructor(id: string, configs: Record<Color, PlayerConfig>, deps: SessionDeps) {
    this.id = id;
    this.deps = deps;
    this.players = {
      w: { config: configs.w, label: playerLabel(configs.w) },
      b: { config: configs.b, label: playerLabel(configs.b) },
    };
  }

  start() {
    this.analyze(0);
    this.scheduleTurn();
  }

  subscribe(fn: (s: GameSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose() {
    this.abort.abort();
    this.listeners.clear();
    this.stopEngines();
  }

  snapshot(): GameSnapshot {
    return structuredClone({
      id: this.id,
      version: this.version,
      players: this.players,
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      moves: this.moves,
      evals: this.evals,
      status: this.result ? "over" : "playing",
      result: this.result,
      thinking: this.thinking,
      drawOffer: this.drawOffer,
      notes: this.notes,
      chat: this.chat,
      mind: this.mind,
      stats: this.stats,
      error: this.error,
      createdAt: this.createdAt,
    });
  }

  /** Apply an action from the human seat. Throws ActionError when it is not allowed. */
  async act(action: Action): Promise<ActionResponse> {
    if (this.result) throw new ActionError("The game is over");
    if (action.type === "retry") {
      if (!this.error) throw new ActionError("Nothing to retry");
      this.error = null;
      this.scheduleTurn();
      this.emit();
      return { snapshot: this.snapshot() };
    }

    const me = this.humanColor();
    const them = opposite(me);
    switch (action.type) {
      case "move": {
        if (this.chess.turn() !== me) throw new ActionError("It is not your turn");
        const move = playMove(this.chess, action.move);
        if (!move) throw new ActionError(`Illegal move: ${action.move}`);
        this.recordMove(move, { fallback: false, declineOffer: true });
        break;
      }
      case "resign":
        this.finish({ winner: them, reason: "resignation" });
        break;
      case "offer_draw":
        if (this.drawOffer) throw new ActionError("A draw offer is already pending");
        this.drawOffer = me;
        this.emit();
        break;
      case "accept_draw":
        if (this.drawOffer !== them) throw new ActionError("There is no draw offer to accept");
        this.finish({ winner: null, reason: "agreement" });
        break;
      case "decline_draw":
        if (this.drawOffer !== them) throw new ActionError("There is no draw offer to decline");
        this.drawOffer = null;
        this.emit();
        break;
      case "chat": {
        const text = action.text.trim().slice(0, 500);
        if (!text) throw new ActionError("Message is empty");
        this.say(me, text);
        this.emit();
        break;
      }
      case "hint": {
        if (this.chess.turn() !== me)
          throw new ActionError("Hints are only available on your turn");
        if (!this.deps.analyzer) throw new ActionError("Stockfish analysis is disabled");
        const ply = this.moves.length;
        const evaluation = await this.evalPromises[ply];
        if (!evaluation?.bestUci || !evaluation.bestSan || ply !== this.moves.length) {
          throw new ActionError("No hint available");
        }
        this.stats[me].hints++;
        this.emit();
        return {
          snapshot: this.snapshot(),
          hint: { uci: evaluation.bestUci, san: evaluation.bestSan },
        };
      }
    }
    return { snapshot: this.snapshot() };
  }

  private humanColor(): Color {
    const humans = (["w", "b"] as const).filter((c) => this.players[c].config.kind === "human");
    if (!humans.length) throw new ActionError("There is no human player in this game");
    return humans.length === 1 ? humans[0]! : this.chess.turn();
  }

  private emit() {
    this.version++;
    if (!this.listeners.size) return;
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  private say(color: Color, text: string) {
    this.chat.push({ color, text, ply: this.moves.length });
    const listener = opposite(color);
    if (this.players[listener].config.kind === "llm") this.inbox[listener].push(text);
  }

  private finish(result: GameResult) {
    this.result = result;
    this.thinking = null;
    this.drawOffer = null;
    this.abort.abort();
    this.stopEngines();
    this.emit();
  }

  private stopEngines() {
    for (const p of Object.values(this.enginePlayers))
      void p.then(
        (e) => e.quit(),
        () => {},
      );
  }

  /** `move` must already be played on `this.chess`. */
  private recordMove(
    move: Move,
    opts: { fallback: boolean; declineOffer: boolean; say?: string; offerDraw?: boolean },
  ) {
    const color = move.color;
    const ply = this.moves.length + 1;
    this.moves.push({
      ply,
      color,
      san: move.san,
      uci: move.lan,
      fen: this.chess.fen(),
      fallback: opts.fallback,
      analysis: null,
    });
    this.evals.push(null);
    if (opts.say) this.say(color, opts.say);
    if (opts.declineOffer && this.drawOffer === opposite(color)) this.drawOffer = null;
    if (opts.offerDraw && !this.drawOffer) this.drawOffer = color;

    this.analyze(ply);
    const result = this.gameOver();
    if (result) return this.finish(result);
    this.emit();
    this.scheduleTurn();
  }

  private gameOver(): GameResult | null {
    const c = this.chess;
    if (c.isCheckmate()) return { winner: opposite(c.turn()), reason: "checkmate" };
    if (c.isStalemate()) return { winner: null, reason: "stalemate" };
    if (c.isInsufficientMaterial()) return { winner: null, reason: "insufficient" };
    if (c.isThreefoldRepetition()) return { winner: null, reason: "threefold" };
    if (c.isDrawByFiftyMoves()) return { winner: null, reason: "fifty_moves" };
    if (this.moves.length >= (this.deps.maxPlies ?? 400))
      return { winner: null, reason: "move_limit" };
    return null;
  }

  private analyze(ply: number) {
    const analyzer = this.deps.analyzer;
    if (!analyzer) return;
    const fen = ply === 0 ? START_FEN : this.moves[ply - 1]!.fen;
    this.evalPromises[ply] = analyzer.evaluate(fen).then(
      (evaluation) => {
        this.evals[ply] = evaluation;
        this.classify(ply);
        this.classify(ply + 1);
        this.emit();
        return evaluation;
      },
      (err: Error) => {
        console.error(`[${this.id}] analysis failed at ply ${ply}: ${err.message}`);
        return null;
      },
    );
  }

  /** Grade the move that led to position `ply`, once both evals are in. */
  private classify(ply: number) {
    const move = this.moves[ply - 1];
    const before = this.evals[ply - 1];
    const after = this.evals[ply];
    if (!move || move.analysis || !before || !after) return;
    const fenBefore = ply === 1 ? START_FEN : this.moves[ply - 2]!.fen;
    move.analysis = analyzeMove(move, before, after, new Chess(fenBefore).moves().length);
  }

  private scheduleTurn() {
    if (this.result || this.thinking || this.error) return;
    const color = this.chess.turn();
    const config = this.players[color].config;
    if (config.kind === "human") return;
    this.thinking = color;
    this.emit();
    void this.runAiTurn(color, config);
  }

  private async runAiTurn(color: Color, config: LlmPlayer | StockfishPlayer) {
    const ply = this.moves.length;
    // An offer made while the AI is already thinking stays pending for its next turn.
    const offerSeen = this.drawOffer === opposite(color);
    const isStale = () => this.result !== null || this.moves.length !== ply;
    try {
      const turn =
        config.kind === "llm"
          ? await this.llmTurn(color, config, offerSeen, isStale)
          : await this.stockfishTurn(color, config, offerSeen);
      if (isStale()) return;
      this.thinking = null;
      this.applyDecision(color, turn.decision, turn.fallback, offerSeen);
    } catch (err) {
      if (this.abort.signal.aborted || isStale()) return;
      this.thinking = null;
      this.error = `${this.players[color].label}: ${(err as Error).message}`;
      const turn = this.mind.at(-1);
      if (turn?.color === color && !turn.done)
        turn.entries.push({ kind: "error", text: (err as Error).message });
      this.emit();
    }
  }

  private async llmTurn(
    color: Color,
    config: LlmPlayer,
    offerSeen: boolean,
    isStale: () => boolean,
  ): Promise<AiOutcome> {
    const turn: AiTurn = { ply: this.moves.length + 1, color, entries: [], done: false };
    this.mind.push(turn);
    if (this.mind.length > MIND_HISTORY) this.mind.shift();
    const messages = [...this.inbox[color]];
    const stats = this.stats[color];

    const outcome = await playLlmTurn(
      this.deps.llm,
      config,
      {
        fen: this.chess.fen(),
        color,
        history: this.moves.map((m) => m.san),
        notes: this.notes[color],
        opponentMessages: messages,
        lastSaid: this.chat.findLast((m) => m.color === color)?.text,
        drawOffered: offerSeen,
        opponentLabel: describeForPrompt(this.players[opposite(color)].config),
        persona: config.persona,
        showLegalMoves: config.showLegalMoves,
      },
      {
        maxCalls: this.deps.maxCallsPerTurn,
        signal: this.abort.signal,
        onEntry: (entry) => {
          turn.entries.push(entry);
          if (!isStale()) this.emit();
        },
        onUsage: ({ costUsd, tokens }) => {
          stats.costUsd += costUsd;
          stats.tokens += tokens;
        },
      },
    );
    turn.done = true;
    this.inbox[color].splice(0, messages.length);
    this.notes[color] = outcome.notes;
    stats.illegalMoves += outcome.illegalMoves;
    if (outcome.fallback) stats.fallbacks++;
    return outcome;
  }

  /** Stockfish accepts a draw only when it is clearly worse. */
  private async stockfishTurn(
    color: Color,
    config: StockfishPlayer,
    offerSeen: boolean,
  ): Promise<AiOutcome> {
    const fen = this.chess.fen();
    if (offerSeen) {
      const e = await this.evalPromises[this.moves.length];
      if (e && (color === "w" ? e.whiteWin : 100 - e.whiteWin) < 30) {
        return { decision: { type: "accept_draw" }, fallback: false };
      }
    }
    const engine = await (this.enginePlayers[color] ??= this.deps.startEnginePlayer(config.skill));
    const move = playMove(new Chess(fen), await engine.bestMove(fen));
    if (!move) throw new Error("Engine returned an illegal move");
    return { decision: { type: "move", move, offerDraw: false }, fallback: false };
  }

  private applyDecision(
    color: Color,
    decision: TurnDecision,
    fallback: boolean,
    offerSeen: boolean,
  ) {
    if (decision.type !== "move") {
      if (decision.say) this.say(color, decision.say);
      return this.finish(
        decision.type === "resign"
          ? { winner: opposite(color), reason: "resignation" }
          : { winner: null, reason: "agreement" },
      );
    }
    const move = this.chess.move(decision.move.lan);
    this.recordMove(move, {
      fallback,
      declineOffer: offerSeen,
      say: decision.say,
      offerDraw: decision.offerDraw,
    });
  }
}
