import { useMemo, useState } from "react";
import { summarize } from "../../shared/analysis";
import { toPgn } from "../../shared/pgn";
import type { Color, GameSnapshot, MoveClass } from "../../shared/types";
import { BADGES, formatUsd, playerIcon, resultText } from "../format";

const SHOWN: MoveClass[] = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

function verdict(accuracy: number | null): string {
  if (accuracy === null) return "No graded moves";
  if (accuracy >= 90) return "Machine-like";
  if (accuracy >= 75) return "Solid";
  if (accuracy >= 60) return "Shaky";
  if (accuracy >= 40) return "Chaotic";
  return "Pure vibes";
}

function worstMove(game: GameSnapshot, color: Color) {
  const worst = game.moves
    .filter(
      (m) => m.color === color && m.analysis && ["mistake", "blunder"].includes(m.analysis.class),
    )
    .sort((a, b) => b.analysis!.winLoss - a.analysis!.winLoss)[0];
  if (!worst) return null;
  const num = `${Math.ceil(worst.ply / 2)}${color === "w" ? "." : "..."}`;
  return `${num} ${worst.san}${BADGES[worst.analysis!.class].icon}${worst.analysis!.bestSan ? ` (best was ${worst.analysis!.bestSan})` : ""}`;
}

export function Summary({
  game,
  onClose,
  onRematch,
}: {
  game: GameSnapshot;
  onClose: () => void;
  onRematch: () => void;
}) {
  const { title, detail } = resultText(game);
  const pgn = useMemo(() => toPgn(game), [game]);
  const [copied, setCopied] = useState(false);
  const winner = game.result?.winner;
  const humanWon = !!winner && game.players[winner].config.kind === "human";

  const copy = () => {
    void navigator.clipboard?.writeText(pgn).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Game summary"
        onClick={(e) => e.stopPropagation()}
      >
        {humanWon && <Confetti />}
        <h2>{title}</h2>
        <p className="muted">{detail}</p>
        <div className="summary-grid">
          {(["w", "b"] as const).map((c) => {
            const info = game.players[c];
            const { accuracy, counts } = summarize(game.moves, c);
            const stats = game.stats[c];
            const worst = worstMove(game, c);
            return (
              <div key={c} className={`summary-side${winner === c ? " winner" : ""}`}>
                <div className="summary-name">
                  <span className={`swatch swatch-${c}`} /> {playerIcon(info.config)} {info.label}
                </div>
                <div className="accuracy">
                  {accuracy === null ? "–" : `${accuracy.toFixed(1)}%`}
                </div>
                <div className="muted small">accuracy · {verdict(accuracy)}</div>
                <ul className="counts">
                  {SHOWN.map((cls) => (
                    <li key={cls}>
                      <span className={`badge badge-${cls}`}>{BADGES[cls].icon}</span>{" "}
                      {BADGES[cls].label}
                      <strong>{counts[cls]}</strong>
                    </li>
                  ))}
                </ul>
                <ul className="extras small">
                  {info.config.kind === "llm" && (
                    <>
                      <li>Illegal move attempts: {stats.illegalMoves}</li>
                      <li>Random fallback moves: {stats.fallbacks}</li>
                      <li>
                        Cost: {formatUsd(stats.costUsd)} ({stats.tokens.toLocaleString()} tokens)
                      </li>
                    </>
                  )}
                  {info.config.kind === "human" && <li>Hints used: {stats.hints}</li>}
                  {worst && <li>Worst move: {worst}</li>}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="button" onClick={copy}>
            {copied ? "Copied!" : "Copy PGN"}
          </button>
          <a
            className="button"
            download={`chess-${game.id}.pgn`}
            href={`data:application/x-chess-pgn;charset=utf-8,${encodeURIComponent(pgn)}`}
          >
            Download PGN
          </a>
          <a
            className="button"
            href="https://lichess.org/paste"
            target="_blank"
            rel="noreferrer"
            onClick={copy}
          >
            Paste into Lichess ↗
          </a>
          <button className="button primary" onClick={onRematch}>
            Rematch, swap colours
          </button>
          <button className="button ghost" onClick={onClose}>
            Review the board
          </button>
        </div>
      </div>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 90 }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.2 + Math.random() * 1.6,
        hue: Math.floor(Math.random() * 360),
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            background: `hsl(${p.hue} 90% 60%)`,
          }}
        />
      ))}
    </div>
  );
}
