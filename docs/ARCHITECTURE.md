# Architecture

A recommendation, not a contract. The code is the source of truth.

## What makes this fun

Losing to an LLM is rare. The fun is watching one think, scheme and trip up.

- **Stockfish as referee.** It analyzes every move from both sides. An eval bar
  swings live, and each move gets a badge: best, excellent, good, inaccuracy,
  mistake or blunder. "GPT hung its queen" shows up the moment it happens.
- **Spy on the AI.** Its private notebook, reasoning text and every tool call,
  illegal attempts included, appear in a "mind" panel.
- **Banter.** Personas (trash talker, pompous GM, nervous novice, pirate,
  coach) talk through an optional `say` field. You can chat back, and the AI
  reads your message on its next turn.
- **Real chess etiquette.** Either side can offer a draw, accept one or resign.
- **Scoreboard at the end.** Accuracy per side, blunder counts, illegal-move
  "hallucinations", hints you used, dollars spent, and a PGN with `[%eval]`
  comments you can paste into Lichess.
- **Any matchup.** Each side is a human, an LLM or Stockfish at a skill level.
  Watching LLM vs LLM, or an LLM against Stockfish level 0, is a show in itself.

## Stack

| Concern | Choice | Why / alternatives |
| --- | --- | --- |
| Rules, SAN/UCI, FEN/PGN | `chess.js` (BSD-2, TypeScript) | `chessops` is stricter and handles variants, but it is GPL and we need neither. |
| Engine | `stockfish` npm 19 (lite single-threaded WASM, GPL-3), spawned as a child process that speaks UCI | It loads in about 200ms and needs no native install. `STOCKFISH_PATH` swaps in a native binary using the same code. |
| Board UI | `react-chessboard` v5 (MIT) | `chessground` gives the Lichess look but is GPL and not React. |
| Server | Hono on Node, with Server-Sent Events | Tiny and typed, and `app.request()` makes routes testable without a socket. |
| LLM API | OpenRouter `chat/completions` with tools, called with plain `fetch` | One key reaches every model. Any OpenAI-compatible base URL works. |
| UI / tests | Vite + React 19, Vitest | |

## Layout

```
src/
  shared/      types used by both sides (snapshot, actions, configs)
  server/
    chess/     pure helpers: move parsing, prompt rendering, PGN export
    engine/    UCI process wrapper, win%/accuracy/classification math
    llm/       OpenRouter client, model catalog, offline random-mover client
    agent/     toolset + the per-turn agent loop
    game/      GameSession (state machine + orchestration), in-memory store
    app.ts     HTTP routes (createApp(deps) for tests)
    index.ts   wiring + static hosting
    arena.ts   headless CLI for running games (LLM vs Stockfish/LLM)
  client/      React app
docs/
```

## Game flow

```
human move ─► POST /api/games/:id/actions ─► GameSession.apply()
                                               ├─► Analyzer (Stockfish queue) ─► move badge + eval
                                               ├─► emit snapshot ─► SSE ─► UI
                                               └─► next player is AI? ─► runTurn()
                                                      LLM: agent loop (tools) ─► apply()
                                                      Stockfish: bestmove at skill N ─► apply()
```

`GameSession` is the single authority. Players are adapters that produce an
action for a position. The server pushes the whole snapshot on every change
(it stays small), so the client stays a pure renderer and reconnects for free.

## The harness

**Fresh context every turn.** Each turn sends `[system, state]` and nothing
else. The state message holds an ASCII board, FEN, the piece list, the move
history in SAN, the last move, any check warning, a pending draw offer, the
opponent's chat, and the AI's own notes. Token cost per turn stays flat
instead of growing with the game. The notebook is the AI's only memory, so
keeping it is a real decision the model makes.

**Toolset** (deliberately tiny):

| Tool | Args | Ends turn |
| --- | --- | --- |
| `make_move` | `move` (SAN or UCI), `say?`, `offer_draw?` | yes, when legal |
| `write_notes` | `notes` (replaces notebook, capped) | no |
| `resign` | `say?` | yes |
| `accept_draw` | `say?`; offered only while the opponent's draw offer is pending | yes |

**Turn budget.** At most 6 model calls per turn. An illegal move returns an
error that lists the legal moves, so the model can correct itself. A reply with
no tool call gets a nudge. When the budget runs out, the harness plays a random
legal move, marks it as a fallback, and counts it against the model. API
failures retry with backoff. If they persist, the game pauses with a Retry
button rather than playing on the model's behalf.

**Robustness for cheap models.** Move input tolerates `1. e4`, `Nf3+`, `e4!`,
`0-0` and UCI. Tool calls written as JSON in plain text are salvaged. A setup
toggle puts the legal-move list in every prompt, which cuts illegal moves a lot
and costs about 100 tokens.

Personas only change the tone of `say`. The system prompt tells every persona
to play its best.

## Stockfish

There are two engine roles, so skill settings never leak into analysis:

- **Analyzer.** One per server, full strength, fixed depth, queued. It
  evaluates every position once and caches the result by ply.
- **Player.** One per Stockfish seat, using `Skill Level` 0–20 and a short
  movetime. It accepts a draw offer only when it is worse.

Move quality uses the Lichess formulas. Here `cp` is centipawns and win% is
from the mover's side:

- `win% = 50 + 50 * (2 / (1 + e^(-0.00368208 * cp)) - 1)`. Mate counts as 0 or 100.
- `accuracy = 103.1668 * e^(-0.04354 * (win%before - win%after)) - 3.1669`, clamped to 0–100.
  Game accuracy is the mean.
- Badges by win% lost: `best` means it matches the engine's move. Then
  `excellent` < 2, `good` < 5, `inaccuracy` < 10, `mistake` < 20, and
  `blunder` from 20 up. A move with no alternative is `forced`.

Hints for the human reuse the cached analysis and are counted on the scoreboard.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/models` | OpenRouter models that support tools, cheapest first, cached 1h. Falls back to a curated list. |
| POST | `/api/games` | `{ white, black }` player configs; returns a snapshot |
| GET | `/api/games/:id` | snapshot |
| GET | `/api/games/:id/stream` | SSE: a snapshot on every change |
| POST | `/api/games/:id/actions` | `move`, `resign`, `offer_draw`, `accept_draw`, `decline_draw`, `chat`, `hint`, `retry` |

## Cheap models to try

Prices change, so `/api/models` shows live ones. Good starters with tool
support, all well under $1 per million input tokens:

- `google/gemini-2.5-flash-lite`: fast, follows tool instructions well.
- `openai/gpt-4.1-nano`: cheapest well-known option, weakest at chess.
- `openai/gpt-5-nano`: a reasoning model, slower but plays better. Use low effort.
- `deepseek/deepseek-chat-v3.1` or newer DeepSeek: strong for the price.
- `x-ai/grok-4-fast`: fast, cheap, decent tool use.

A full game costs roughly 40 turns × ~1.5k tokens, which is a fraction of a cent
on these models. Reasoning models cost several times more.

## Not built (yet)

- Persisting games and a per-model Elo leaderboard (SQLite would be enough).
- Clocks and time controls.
- Brilliant-move detection, which needs MultiPV and sacrifice heuristics.
- Letting the LLM "see" the Stockfish eval as a handicap or coaching mode.
