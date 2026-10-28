import { Chess } from "chess.js";
import { afterAll, describe, expect, it } from "vitest";
import { analyzeMove } from "../../shared/analysis";
import { StockfishAnalyzer, startEnginePlayer } from "./stockfish";
import { UciEngine } from "./uci";

// Real engine (bundled WASM build): slower than unit tests, but proves the UCI plumbing.
const SCHOLARS_MATE_IN_1 = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 2 3";
const analyzer = new StockfishAnalyzer(undefined, 10);
afterAll(() => analyzer.quit());

describe("UciEngine", () => {
  it("finds a mate in one", async () => {
    const engine = await UciEngine.start();
    const res = await engine.search(SCHOLARS_MATE_IN_1, { depth: 8 });
    engine.quit();
    expect(res).toMatchObject({ bestUci: "h5f7", score: { mate: 1 } });
  });

  it("serializes concurrent searches", async () => {
    const fens = [new Chess().fen(), SCHOLARS_MATE_IN_1, "3qk3/8/8/8/8/8/8/4K3 w - - 0 1"];
    const results = await Promise.all(fens.map((fen) => analyzer.evaluate(fen)));
    expect(results[1]!.bestSan).toBe("Qxf7#");
    expect(results[2]!.score).toMatchObject({ cp: expect.any(Number) });
    expect(results[2]!.whiteWin).toBeLessThan(15);
  });
});

describe("StockfishAnalyzer", () => {
  it("reports scores from White's point of view", async () => {
    // Black to move, and Black is a queen up.
    const e = await analyzer.evaluate("3qk3/8/8/8/8/8/8/4K3 b - - 0 1");
    expect("cp" in e.score ? e.score.cp : -Infinity).toBeLessThan(-500);
    expect(e.whiteWin).toBeLessThan(15);
  });

  it("handles checkmated and stalemated positions", async () => {
    const mated = await analyzer.evaluate(
      "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
    );
    expect(mated).toMatchObject({ score: { mate: 0 }, whiteWin: 0, bestUci: null });
    const stalemate = await analyzer.evaluate("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(stalemate).toMatchObject({ score: { cp: 0 }, whiteWin: 50, bestUci: null });
  });

  it("flags walking into mate as a blunder", async () => {
    const before = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";
    const chess = new Chess(before);
    const blunder = chess.move("Nf6"); // allows Qxf7#
    const [b, a] = await Promise.all([analyzer.evaluate(before), analyzer.evaluate(chess.fen())]);
    const analysis = analyzeMove({ color: "b", uci: blunder.lan }, b, a, 30);
    expect(analysis).toMatchObject({ class: "blunder", bestSan: expect.any(String) });
    expect(analysis.accuracy).toBeLessThan(10);
  });
});

describe("StockfishAnalyzer recovery", () => {
  it("restarts the engine after it dies on a bad position", async () => {
    const fresh = new StockfishAnalyzer(undefined, 6);
    // White king in check with Black to move: Stockfish exits on this.
    await expect(fresh.evaluate("4k3/8/8/8/8/8/3q4/4K3 b - - 0 1")).rejects.toThrow();
    expect((await fresh.evaluate(SCHOLARS_MATE_IN_1)).bestSan).toBe("Qxf7#");
    await fresh.quit();
  });
});

describe("startEnginePlayer", () => {
  it("returns a legal move at low skill", async () => {
    const player = await startEnginePlayer(0);
    const uci = await player.bestMove(new Chess().fen());
    player.quit();
    expect(new Chess().moves({ verbose: true }).map((m) => m.lan)).toContain(uci);
  });
});
