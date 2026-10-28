import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface SearchResult {
  /** null when the side to move has no legal moves. */
  bestUci: string | null;
  /** Side-to-move point of view. */
  score: { cp: number } | { mate: number };
  depth: number;
}

export type SearchLimits = { depth: number } | { movetime: number };

/** The bundled single-threaded "lite" WASM build: tiny, fast to start, far stronger than any human. */
export function bundledEnginePath(): string {
  const require = createRequire(import.meta.url);
  return (require("stockfish") as { findEngine(flavor: string): string }).findEngine("lite-single");
}

/**
 * A UCI engine in a child process. Commands are serialized, so concurrent
 * callers queue up instead of interleaving their output.
 */
export class UciEngine {
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>;
  private waiter: {
    match: (line: string) => boolean;
    resolve: () => void;
    reject: (e: Error) => void;
  } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private exited = false;

  private constructor(path: string) {
    const [cmd, args] = path.endsWith(".js") ? [process.execPath, [path]] : [path, []];
    this.proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "ignore"] });
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      if (this.waiter?.match(line.trim())) {
        this.waiter.resolve();
        this.waiter = null;
      }
    });
    const onExit = (err?: Error) => {
      this.exited = true;
      this.waiter?.reject(err ?? new Error("Engine exited"));
      this.waiter = null;
    };
    this.proc.on("exit", () => onExit());
    this.proc.on("error", onExit);
  }

  static async start(path = bundledEnginePath(), options: Record<string, string | number> = {}) {
    const engine = new UciEngine(path);
    await engine.run(() => {
      engine.send("uci");
      return engine.until((l) => l === "uciok");
    });
    for (const [name, value] of Object.entries(options))
      engine.send(`setoption name ${name} value ${value}`);
    await engine.run(() => {
      engine.send("isready");
      return engine.until((l) => l === "readyok");
    });
    return engine;
  }

  search(fen: string, limits: SearchLimits): Promise<SearchResult> {
    return this.run(() => {
      const result: SearchResult = { bestUci: null, score: { cp: 0 }, depth: 0 };
      this.send(`position fen ${fen}`);
      this.send("depth" in limits ? `go depth ${limits.depth}` : `go movetime ${limits.movetime}`);
      return this.until((line) => {
        if (line.startsWith("info") && line.includes(" score ") && !/ multipv [2-9]/.test(line)) {
          const m = / depth (\d+).* score (cp|mate) (-?\d+)/.exec(line);
          if (m && !line.includes("bound")) {
            result.depth = Number(m[1]);
            result.score = m[2] === "cp" ? { cp: Number(m[3]) } : { mate: Number(m[3]) };
          }
        }
        if (!line.startsWith("bestmove")) return false;
        const best = line.split(" ")[1];
        result.bestUci = best && best !== "(none)" ? best : null;
        return true;
      }).then(() => result);
    });
  }

  quit() {
    if (this.exited) return;
    this.send("quit");
    setTimeout(() => this.proc.kill(), 500).unref();
  }

  private send(cmd: string) {
    if (!this.exited) this.proc.stdin.write(`${cmd}\n`);
  }

  private until(match: (line: string) => boolean): Promise<void> {
    if (this.exited) return Promise.reject(new Error("Engine has exited"));
    return new Promise((resolve, reject) => {
      this.waiter = { match, resolve, reject };
    });
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task);
    this.queue = next.catch(() => {});
    return next;
  }
}
