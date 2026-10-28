import { useEffect, useRef } from "react";
import type { GameSnapshot, MindEntry } from "../../shared/types";

function prettyArgs(args: string): string {
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" · ");
  } catch {
    return args;
  }
}

function Entry({ entry }: { entry: MindEntry }) {
  switch (entry.kind) {
    case "reasoning":
      return (
        <details className="entry reasoning">
          <summary>💭 reasoning</summary>
          <p>{entry.text}</p>
        </details>
      );
    case "text":
      return <p className="entry text">🗨 {entry.text}</p>;
    case "tool":
      return (
        <div className={`entry tool ${entry.ok ? "ok" : "fail"}`}>
          <code>{entry.name}</code> <span className="args">{prettyArgs(entry.args)}</span>
          <div className="result">
            {entry.ok ? "✓" : "✗"} {entry.result}
          </div>
        </div>
      );
    case "fallback":
      return <p className="entry fallback">🎲 {entry.text}</p>;
    case "error":
      return <p className="entry error">⚠ {entry.text}</p>;
  }
}

export function MindPanel({
  game,
  spy,
  onToggleSpy,
}: {
  game: GameSnapshot;
  spy: boolean;
  onToggleSpy: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const llmSeats = (["w", "b"] as const).filter((c) => game.players[c].config.kind === "llm");
  const entryCount = game.mind.reduce((n, t) => n + t.entries.length, 0);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [entryCount]);

  if (!llmSeats.length) {
    return (
      <div className="panel mind-panel">
        <h3>🧠 AI mind</h3>
        <p className="muted small pad">No LLM in this game, so nothing to spy on.</p>
      </div>
    );
  }

  return (
    <div className="panel mind-panel">
      <h3>
        🧠 AI mind
        <button
          className="button tiny ghost"
          onClick={onToggleSpy}
          title="Hide or reveal the AI's thoughts"
        >
          {spy ? "🙈 Hide" : "👁 Spy"}
        </button>
      </h3>
      <div className={`mind${spy ? "" : " hidden-thoughts"}`} ref={scroller}>
        {llmSeats.map((c) => (
          <div key={c} className="notebook">
            <div className="notebook-title">📓 {game.players[c].label}'s notebook</div>
            <pre>{game.notes[c] || "(empty)"}</pre>
          </div>
        ))}
        {game.mind.map((turn) => (
          <div key={`${turn.ply}-${turn.color}`} className={`turn turn-${turn.color}`}>
            <div className="turn-title">
              Move {Math.ceil(turn.ply / 2)} · {game.players[turn.color].label}
              {!turn.done && <span className="dots" />}
            </div>
            {turn.entries.map((e, i) => (
              <Entry key={i} entry={e} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
