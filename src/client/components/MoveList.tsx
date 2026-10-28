import { useEffect, useRef } from "react";
import type { GameSnapshot, MoveRecord } from "../../shared/types";
import { BADGES } from "../format";

interface Props {
  game: GameSnapshot;
  viewPly: number | null;
  onSelect: (ply: number | null) => void;
}

function MoveCell({
  move,
  active,
  onSelect,
}: {
  move?: MoveRecord;
  active: boolean;
  onSelect: () => void;
}) {
  if (!move) return <td />;
  const badge = move.analysis && BADGES[move.analysis.class];
  return (
    <td>
      <button className={`move${active ? " active" : ""}`} onClick={onSelect} title={badge?.label}>
        {move.san}
        {badge && <span className={`badge badge-${move.analysis!.class}`}>{badge.icon}</span>}
        {move.fallback && <span title="Random move played by the harness">🎲</span>}
      </button>
    </td>
  );
}

export function MoveList({ game, viewPly, onSelect }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = Array.from({ length: Math.ceil(game.moves.length / 2) }, (_, i) => i);
  const current = viewPly ?? game.moves.length;

  useEffect(() => {
    if (viewPly === null) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [game.moves.length, viewPly]);

  return (
    <div className="panel moves-panel">
      <EvalGraph game={game} current={current} onSelect={onSelect} />
      <div className="moves" ref={scroller}>
        {game.moves.length === 0 ? (
          <p className="muted small pad">No moves yet.</p>
        ) : (
          <table>
            <tbody>
              {rows.map((i) => (
                <tr key={i}>
                  <th>{i + 1}.</th>
                  {[game.moves[2 * i], game.moves[2 * i + 1]].map((m, j) => (
                    <MoveCell
                      key={j}
                      move={m}
                      active={!!m && m.ply === current}
                      onSelect={() => m && onSelect(m.ply)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** White's winning chances over the game; click to jump to a position. */
function EvalGraph({
  game,
  current,
  onSelect,
}: {
  game: GameSnapshot;
  current: number;
  onSelect: (ply: number) => void;
}) {
  const W = 300;
  const H = 56;
  const n = Math.max(game.moves.length, 1);
  const x = (ply: number) => (ply / n) * W;
  const y = (win: number) => H - (win / 100) * H;
  const graded = game.evals.flatMap((e, ply) => (e ? [{ ply, win: e.whiteWin }] : []));
  const points = graded.map((p) => `${x(p.ply).toFixed(1)},${y(p.win).toFixed(1)}`);
  const lastX = x(graded.at(-1)?.ply ?? 0);
  const marks = game.moves.filter(
    (m) => m.analysis && ["mistake", "blunder"].includes(m.analysis.class),
  );

  return (
    <svg
      className="evalgraph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        onSelect(Math.round(((e.clientX - box.left) / box.width) * n));
      }}
    >
      <rect width={W} height={H} className="evalgraph-bg" />
      {points.length > 1 && (
        <polygon className="evalgraph-area" points={`0,${H} ${points.join(" ")} ${lastX},${H}`} />
      )}
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="evalgraph-mid" />
      <line x1={x(current)} x2={x(current)} y1={0} y2={H} className="evalgraph-cursor" />
      {marks.map((m) => {
        const e = game.evals[m.ply];
        return e ? (
          <circle
            key={m.ply}
            cx={x(m.ply)}
            cy={y(e.whiteWin)}
            r={3.5}
            className={`mark-${m.analysis!.class}`}
          />
        ) : null;
      })}
    </svg>
  );
}
