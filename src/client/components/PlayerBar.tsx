import { useEffect, useState } from "react";
import { PERSONAS } from "../../shared/personas";
import type { ChatMessage, Color, PlayerInfo, SideStats } from "../../shared/types";
import { formatUsd, playerIcon } from "../format";

interface Props {
  color: Color;
  info: PlayerInfo;
  stats: SideStats;
  toMove: boolean;
  thinking: boolean;
  captured: { pieces: string; lead: number };
  /** Latest thing this player said, shown as a speech bubble. */
  bubble: ChatMessage | null;
}

function useSecondsSince(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return setSeconds(0);
    const start = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, [active]);
  return seconds;
}

export function PlayerBar({ color, info, stats, toMove, thinking, captured, bubble }: Props) {
  const seconds = useSecondsSince(thinking);
  const cfg = info.config;
  return (
    <div className={`playerbar${toMove ? " to-move" : ""}`}>
      <span className={`swatch swatch-${color}`} />
      <span className="avatar">{playerIcon(cfg)}</span>
      <div className="who">
        <strong title={cfg.kind === "llm" ? cfg.model : undefined}>{info.label}</strong>
        <span className="muted small">
          {cfg.kind === "llm"
            ? PERSONAS[cfg.persona].label
            : cfg.kind === "stockfish"
              ? "Engine"
              : "Human"}
          <span className={`captured captured-${color === "w" ? "b" : "w"}`}>
            {captured.pieces}
          </span>
          {captured.lead > 0 && <span className="lead">+{captured.lead}</span>}
        </span>
      </div>
      {thinking && (
        <span className="thinking">
          <span className="dots" /> thinking {seconds}s
        </span>
      )}
      <div className="chips">
        {stats.illegalMoves > 0 && (
          <span className="chip bad" title="Illegal move attempts">
            ✗ {stats.illegalMoves} illegal
          </span>
        )}
        {stats.fallbacks > 0 && (
          <span className="chip bad" title="Random moves played by the harness after the AI failed">
            🎲 {stats.fallbacks}
          </span>
        )}
        {stats.hints > 0 && (
          <span className="chip" title="Hints used">
            💡 {stats.hints}
          </span>
        )}
        {cfg.kind === "llm" && (
          <span className="chip" title={`${stats.tokens.toLocaleString()} tokens`}>
            {formatUsd(stats.costUsd)}
          </span>
        )}
      </div>
      {bubble && (
        <div key={`${bubble.ply}-${bubble.text}`} className="bubble">
          {bubble.text}
        </div>
      )}
    </div>
  );
}
