/**
 * Headless games for testing and benchmarking.
 *
 *   npm run arena -- --white openai/gpt-5-nano --black stockfish:0
 *   npm run arena -- --white local/random-mover --black google/gemini-2.5-flash-lite --max-plies 40
 *
 * A player is `stockfish:<0-20>` or a model id. Exits non-zero if a model call fails.
 */
import { parseArgs } from "node:util";
import { formatScore, summarize } from "../shared/analysis";
import { PERSONAS } from "../shared/personas";
import { toPgn } from "../shared/pgn";
import type {
  Color,
  GameSnapshot,
  PersonaId,
  PlayerConfig,
  ReasoningEffort,
} from "../shared/types";
import { createDeps, loadConfig } from "./deps";
import { GameStore } from "./game/store";

const { values: args } = parseArgs({
  options: {
    white: { type: "string", default: "local/random-mover" },
    black: { type: "string", default: "stockfish:0" },
    persona: { type: "string", default: "trash_talker" },
    reasoning: { type: "string" },
    "no-legal": { type: "boolean", default: false },
    "max-plies": { type: "string", default: "120" },
  },
});

function player(spec: string): PlayerConfig {
  const sf = /^stockfish:(\d+)$/.exec(spec);
  if (sf) return { kind: "stockfish", skill: Number(sf[1]) };
  if (!(args.persona! in PERSONAS)) throw new Error(`Unknown persona ${args.persona}`);
  return {
    kind: "llm",
    model: spec,
    persona: args.persona as PersonaId,
    showLegalMoves: !args["no-legal"],
    reasoning: args.reasoning as ReasoningEffort | undefined,
  };
}

const deps = { ...createDeps(loadConfig()), maxPlies: Number(args["max-plies"]) };
const game = new GameStore(deps).create({ w: player(args.white!), b: player(args.black!) });

let printedMoves = 0;
let printedChat = 0;
const seenEntries = new Set<string>();

/** Moves print once graded, so each line carries its badge and eval. */
function printMoves(s: GameSnapshot, all = false) {
  while (printedMoves < s.moves.length && (all || s.moves[printedMoves]!.analysis)) {
    const m = s.moves[printedMoves++]!;
    const evaluation = s.evals[m.ply];
    const num = `${Math.ceil(m.ply / 2)}${m.color === "w" ? "." : "..."}`;
    const score = evaluation ? formatScore(evaluation.score) : "";
    console.log(
      `${num.padStart(5)} ${m.san.padEnd(8)} ${(m.analysis?.class ?? "").padEnd(11)} ${score}${m.fallback ? "  (random fallback)" : ""}`,
    );
  }
}

const final = await new Promise<GameSnapshot>((resolve) => {
  game.subscribe((s) => {
    for (const turn of s.mind) {
      turn.entries.forEach((e, i) => {
        const key = `${turn.ply}:${i}`;
        if (seenEntries.has(key)) return;
        seenEntries.add(key);
        if (e.kind === "tool" && !e.ok)
          console.log(`      ✗ ${e.name} ${e.args} → ${e.result.slice(0, 80)}`);
        if (e.kind === "fallback" || e.kind === "error") console.log(`      ! ${e.text}`);
      });
    }
    printMoves(s);
    for (; printedChat < s.chat.length; printedChat++) {
      const c = s.chat[printedChat]!;
      console.log(`      💬 ${s.players[c.color].label}: ${c.text}`);
    }
    if (s.error || (s.status === "over" && s.moves.every((m) => m.analysis))) resolve(s);
    if (s.status === "over") setTimeout(() => resolve(game.snapshot()), 20_000).unref();
  });
  setTimeout(() => resolve(game.snapshot()), 60 * 60_000).unref();
});

printMoves(final, true);
console.log(
  `\nResult: ${final.result ? `${final.result.winner ? `${final.players[final.result.winner].label} wins` : "draw"} by ${final.result.reason}` : "unfinished"}`,
);
if (final.error) console.log(`Error: ${final.error}`);
for (const color of ["w", "b"] as Color[]) {
  const { accuracy, counts } = summarize(final.moves, color);
  const st = final.stats[color];
  console.log(
    `${final.players[color].label.padEnd(28)} accuracy ${accuracy?.toFixed(1) ?? "-"}%  blunders ${counts.blunder}  mistakes ${counts.mistake}  illegal ${st.illegalMoves}  fallbacks ${st.fallbacks}  cost $${st.costUsd.toFixed(4)}  tokens ${st.tokens}`,
  );
}
console.log(`\n${toPgn(final)}`);
game.dispose();
await deps.shutdown();
process.exit(final.error ? 1 : 0);
