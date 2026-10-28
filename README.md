# chess-harness

Play chess against LLMs, or watch them play each other, in the browser. Stockfish
referees every move.

The AI gets a deliberately tiny toolset: `make_move`, `write_notes`, `resign` and
`accept_draw`. Its notebook is its only memory between turns. Stockfish grades
every move from both sides (best, excellent, good, inaccuracy, mistake, blunder),
drives a live eval bar and ends the game with an accuracy report.

What makes it fun:

- **Spy mode.** Read the AI's private notebook, reasoning and every tool call,
  including its illegal-move hallucinations.
- **Personalities.** Trash talker, pompous grandmaster, nervous novice, pirate,
  coach. Chat back, and the AI reads your message on its next turn.
- **Draw offers and resignations** in both directions.
- **Any matchup.** Each side can be you, any OpenRouter model, or Stockfish at
  skill 0–20.
- **The aftermath.** Accuracy, blunder counts, the worst move with the engine's
  better idea, dollars spent, and an annotated PGN for Lichess.

## Quick start

```bash
npm install
cp .env.example .env        # then set OPENROUTER_API_KEY
npm run dev                 # http://localhost:5173
```

No key yet? Pick **Random mover (offline test bot)** as the opponent. It speaks the
same tool protocol and plays random moves, which is enough to try everything.

For a single-port production build:

```bash
npm run build && npm start  # http://localhost:8787
```

## Headless arena

Run games from the terminal to smoke-test models or compare them:

```bash
npm run arena -- --white anthropic/claude-haiku-5.5 --black stockfish:1 --max-plies 60
npm run arena -- --white openai/gpt-6-luna --black deepseek/deepseek-v4.1-flash
npm run arena -- --white google/gemini-2.5-flash-lite --black stockfish:0 --no-legal --persona pirate
```

Each move prints with its badge and eval, along with illegal attempts and chat.
At the end you get accuracy, cost and the PGN.

## Development

```bash
npm test            # unit + integration tests (spawns the real Stockfish WASM engine)
npm run typecheck
npm run format
```

| Env var               | Default                        | Purpose                                     |
| --------------------- | ------------------------------ | ------------------------------------------- |
| `OPENROUTER_API_KEY`  | none                           | Needed for LLM players                      |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Any OpenAI-compatible endpoint              |
| `STOCKFISH_PATH`      | bundled WASM build             | Use a native Stockfish binary instead       |
| `ANALYSIS_DEPTH`      | `14`                           | Depth of the referee's search               |
| `PORT`                | `8787`                         | API port (Vite proxies `/api` to it in dev) |

Behind an HTTP proxy? Node's `fetch` ignores `HTTPS_PROXY` unless you set
`NODE_USE_ENV_PROXY=1` (Node 22.21+).

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers how the harness, game loop
and analysis fit together, and which cheap models played well in live tests.

## License note

The bundled engine (`stockfish` npm package) is GPL-3.0. Keep that in mind if
you distribute this project.
