import { formatScore } from "../../shared/analysis";
import type { PositionEval } from "../../shared/types";

export function EvalBar({
  evaluation,
  flipped,
}: {
  evaluation: PositionEval | null;
  flipped: boolean;
}) {
  const white = evaluation?.whiteWin ?? 50;
  const label = evaluation ? formatScore(evaluation.score) : "…";
  return (
    <div
      className={`evalbar${flipped ? " flipped" : ""}`}
      title={`White's winning chances: ${white.toFixed(0)}%`}
    >
      <div className="evalbar-white" style={{ height: `${white}%` }} />
      <span className={`evalbar-label ${white >= 50 ? "on-white" : "on-black"}`}>{label}</span>
    </div>
  );
}
