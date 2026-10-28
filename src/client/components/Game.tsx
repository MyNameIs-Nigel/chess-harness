import { Chess, DEFAULT_POSITION } from "chess.js";
import { useEffect, useState } from "react";
import type { Arrow } from "react-chessboard";
import {
  opposite,
  type Action,
  type Color,
  type GameSnapshot,
  type Hint,
  type MoveRecord,
} from "../../shared/types";
import { api, useGame } from "../api";
import { BADGES, captures } from "../format";
import { Board } from "./Board";
import { ChatPanel } from "./ChatPanel";
import { EvalBar } from "./EvalBar";
import { MindPanel } from "./MindPanel";
import { MoveList } from "./MoveList";
import { PlayerBar } from "./PlayerBar";
import { Summary } from "./Summary";

function useStoredFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : saved === "1";
    } catch {
      return initial;
    }
  });
  const toggle = () =>
    setValue((v) => {
      try {
        localStorage.setItem(key, v ? "0" : "1");
      } catch {
        // storage may be unavailable
      }
      return !v;
    });
  return [value, toggle] as const;
}

const squares = (uci: string) => ({ startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4) });

function latestEval(game: GameSnapshot) {
  for (let i = game.moves.length; i >= 0; i--) if (game.evals[i]) return game.evals[i]!;
  return null;
}

function Verdict({ game, move }: { game: GameSnapshot; move: MoveRecord | undefined }) {
  if (!move?.analysis) {
    return <div className="verdict muted">Stockfish is watching every move…</div>;
  }
  const { class: cls, bestSan } = move.analysis;
  const who = game.players[move.color].label;
  const better =
    bestSan && cls !== "best" && cls !== "forced" && bestSan !== move.san
      ? ` Best was ${bestSan}.`
      : "";
  return (
    <div className={`verdict verdict-${cls}`}>
      <span className={`badge badge-${cls}`}>{BADGES[cls].icon}</span>
      <span>
        <strong>{BADGES[cls].label}.</strong> {who} played {move.san}.{better}
      </span>
    </div>
  );
}

export function Game({ id }: { id: string }) {
  const { game, missing, setGame } = useGame(id);
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [hint, setHint] = useState<(Hint & { ply: number }) | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [confirmResign, setConfirmResign] = useState(false);
  const [spy, toggleSpy] = useStoredFlag("chess-harness:spy", true);
  const plies = game?.moves.length ?? 0;

  useEffect(() => setPending(null), [plies]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const current = viewPly ?? plies;
      if (e.key === "ArrowLeft") setViewPly(Math.max(0, current - 1));
      else if (e.key === "ArrowRight") setViewPly(current + 1 >= plies ? null : current + 1);
      else if (e.key === "Home") setViewPly(0);
      else if (e.key === "End" || e.key === "Escape") setViewPly(null);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [viewPly, plies]);

  if (missing) {
    return (
      <div className="center">
        <p>This game no longer exists. The server may have restarted.</p>
        <a className="button primary" href="#/">
          New game
        </a>
      </div>
    );
  }
  if (!game) return <div className="center muted">Loading game…</div>;

  const humans = (["w", "b"] as const).filter((c) => game.players[c].config.kind === "human");
  const me: Color | null = humans.length === 2 ? game.turn : (humans[0] ?? null);
  const home: Color = humans.length === 1 ? humans[0]! : "w";
  const bottom = flipped ? opposite(home) : home;
  const live = viewPly === null || viewPly >= plies;
  const shownPly = live ? plies : viewPly;
  const playing = game.status === "playing";
  const myTurn = playing && me !== null && game.turn === me && !game.thinking;
  const shownMove = shownPly > 0 ? game.moves[shownPly - 1] : undefined;
  const fen = live ? (pending ?? game.fen) : (shownMove?.fen ?? DEFAULT_POSITION);
  const taken = captures(fen);

  const arrows: Arrow[] = [];
  if (live && hint?.ply === plies)
    arrows.push({ ...squares(hint.uci), color: "rgba(60, 140, 255, 0.85)" });
  const bestBefore = shownMove && game.evals[shownPly - 1]?.bestUci;
  if (
    !live &&
    bestBefore &&
    shownMove.analysis &&
    !["best", "forced"].includes(shownMove.analysis.class)
  ) {
    arrows.push({ ...squares(bestBefore), color: "rgba(40, 200, 120, 0.85)" });
  }

  async function act(action: Action) {
    try {
      const res = await api.act(id, action);
      setGame(res.snapshot);
      return res;
    } catch (e) {
      setPending(null);
      setNotice((e as Error).message);
      return null;
    }
  }

  function move(uci: string) {
    const chess = new Chess(game!.fen);
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      setPending(chess.fen());
    } catch {
      // the server will reject it too
    }
    setHint(null);
    void act({ type: "move", move: uci });
  }

  async function rematch() {
    try {
      const next = await api.createGame(game!.players.b.config, game!.players.w.config);
      location.hash = `#/game/${next.id}`;
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  const lastSaid = (c: Color) => {
    const m = game.chat.findLast((msg) => msg.color === c);
    return m && plies - m.ply <= 1 ? m : null;
  };
  const bar = (c: Color) => (
    <PlayerBar
      color={c}
      info={game.players[c]}
      stats={game.stats[c]}
      toMove={playing && game.turn === c}
      thinking={game.thinking === c}
      captured={taken[c]}
      bubble={lastSaid(c)}
    />
  );
  const offeredBy = game.drawOffer;

  return (
    <div className="game">
      <div className="board-col">
        {bar(opposite(bottom))}
        <div className="board-row">
          <EvalBar
            evaluation={live ? latestEval(game) : (game.evals[shownPly] ?? null)}
            flipped={bottom === "b"}
          />
          <Board
            fen={fen}
            orientation={bottom === "w" ? "white" : "black"}
            interactive={live && myTurn && !pending}
            lastMove={
              shownMove ? { from: shownMove.uci.slice(0, 2), to: shownMove.uci.slice(2, 4) } : null
            }
            arrows={arrows}
            onMove={move}
          />
        </div>
        {bar(bottom)}

        <div className="controls">
          <button className="button ghost" onClick={() => setFlipped((f) => !f)} title="Flip board">
            ⇅ Flip
          </button>
          {me && playing && (
            <>
              <button
                className="button"
                disabled={!myTurn || !live}
                onClick={async () => {
                  const res = await act({ type: "hint" });
                  if (res?.hint) setHint({ ...res.hint, ply: plies });
                }}
              >
                💡 Hint
              </button>
              <button
                className="button"
                disabled={offeredBy !== null}
                onClick={() => act({ type: "offer_draw" })}
              >
                ½ Offer draw
              </button>
              <button
                className={`button ${confirmResign ? "danger" : ""}`}
                onClick={() => (confirmResign ? act({ type: "resign" }) : setConfirmResign(true))}
                onBlur={() => setConfirmResign(false)}
              >
                {confirmResign ? "Really resign?" : "🏳 Resign"}
              </button>
            </>
          )}
          {!playing && (
            <button className="button primary" onClick={() => setSummaryOpen(true)}>
              📊 Results
            </button>
          )}
          {!live && (
            <button className="button" onClick={() => setViewPly(null)}>
              ⏭ Back to live
            </button>
          )}
        </div>

        {hint && hint.ply === plies && live && (
          <div className="banner info">💡 Stockfish suggests {hint.san}</div>
        )}
        {game.error && (
          <div className="banner error">
            ⚠ {game.error}
            <button className="button tiny" onClick={() => act({ type: "retry" })}>
              Retry
            </button>
          </div>
        )}
        {playing && offeredBy && me && offeredBy !== me && (
          <div className="banner info">
            🤝 {game.players[offeredBy].label} offers a draw.
            <button className="button tiny primary" onClick={() => act({ type: "accept_draw" })}>
              Accept
            </button>
            <button className="button tiny" onClick={() => act({ type: "decline_draw" })}>
              Decline
            </button>
          </div>
        )}
        {playing && offeredBy && offeredBy === me && humans.length === 1 && (
          <div className="banner">
            🤝 You offered a draw. Waiting for {game.players[opposite(me)].label}…
          </div>
        )}
        {!me && playing && (
          <div className="banner">
            👀 Spectating {game.players.w.label} vs {game.players.b.label}
          </div>
        )}
        {!live && (
          <p className="muted small">Reviewing move {shownPly}. Use ← → to step, Esc to return.</p>
        )}
      </div>

      <div className="side-col">
        <Verdict game={game} move={live ? game.moves.findLast((m) => m.analysis) : shownMove} />
        <MoveList
          game={game}
          viewPly={live ? null : shownPly}
          onSelect={(p) => setViewPly(p === null || p >= plies ? null : p)}
        />
        <ChatPanel game={game} me={me} onSend={(text) => act({ type: "chat", text })} />
      </div>

      <div className="mind-col">
        <MindPanel game={game} spy={spy} onToggleSpy={toggleSpy} />
      </div>

      {!playing && summaryOpen && (
        <Summary game={game} onClose={() => setSummaryOpen(false)} onRematch={rematch} />
      )}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
