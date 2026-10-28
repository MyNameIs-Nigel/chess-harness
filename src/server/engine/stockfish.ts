import { Chess } from "chess.js";
import { winPercent } from "../../shared/analysis";
import type { PositionEval, Score } from "../../shared/types";
import { uciToSan } from "../chess/moves";
import { UciEngine } from "./uci";

export interface Analyzer {
  evaluate(fen: string): Promise<PositionEval>;
}

export interface EnginePlayer {
  bestMove(fen: string): Promise<string>;
  quit(): void;
}

/** Full-strength fixed-depth evaluation, from White's point of view. */
export class StockfishAnalyzer implements Analyzer {
  private engine: Promise<UciEngine>;
  private readonly enginePath: string | undefined;
  private readonly depth: number;

  constructor(enginePath?: string, depth = 14) {
    this.enginePath = enginePath;
    this.engine = UciEngine.start(enginePath);
    this.depth = depth;
  }

  async evaluate(fen: string): Promise<PositionEval> {
    const engine = this.engine;
    let res;
    try {
      res = await (await engine).search(fen, { depth: this.depth });
    } catch (err) {
      // The engine process dies on positions it rejects; start a fresh one for later requests.
      if (this.engine === engine) this.engine = UciEngine.start(this.enginePath);
      throw err;
    }
    const whiteToMove = new Chess(fen).turn() === "w";
    const stmWin = winPercent(res.score);
    const score: Score =
      "mate" in res.score
        ? { mate: whiteToMove || res.score.mate === 0 ? res.score.mate : -res.score.mate }
        : { cp: whiteToMove ? res.score.cp : 0 - res.score.cp }; // 0 - x: no -0 in JSON
    return {
      score,
      whiteWin: whiteToMove ? stmWin : 100 - stmWin,
      bestUci: res.bestUci,
      bestSan: res.bestUci ? uciToSan(fen, res.bestUci) : null,
    };
  }

  async quit() {
    (await this.engine).quit();
  }
}

/** Stockfish as an opponent, weakened with UCI "Skill Level" (0-20). */
export async function startEnginePlayer(skill: number, enginePath?: string): Promise<EnginePlayer> {
  const engine = await UciEngine.start(enginePath, {
    "Skill Level": Math.max(0, Math.min(20, skill)),
  });
  return {
    async bestMove(fen) {
      const res = await engine.search(fen, { movetime: 200 + skill * 40 });
      if (!res.bestUci) throw new Error("Engine found no move");
      return res.bestUci;
    },
    quit: () => engine.quit(),
  };
}
