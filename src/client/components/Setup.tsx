import { useEffect, useState } from "react";
import { PERSONAS } from "../../shared/personas";
import type {
  Color,
  Health,
  ModelInfo,
  PersonaId,
  PlayerConfig,
  ReasoningEffort,
} from "../../shared/types";
import { api } from "../api";
import { estimateGameCost, formatUsd } from "../format";

type Kind = PlayerConfig["kind"];

interface Seat {
  kind: Kind;
  model: string;
  customModel: string;
  persona: PersonaId;
  showLegalMoves: boolean;
  reasoning: ReasoningEffort | "";
  skill: number;
}

const STORAGE_KEY = "chess-harness:setup";
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";

const defaultSeat = (kind: Kind): Seat => ({
  kind,
  model: DEFAULT_MODEL,
  customModel: "",
  persona: "trash_talker",
  showLegalMoves: true,
  reasoning: "",
  skill: 3,
});

function loadSeats(): Record<Color, Seat> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Record<
      Color,
      Seat
    > | null;
    if (saved?.w && saved.b) return saved;
  } catch {
    // ignore unreadable storage
  }
  return { w: defaultSeat("human"), b: defaultSeat("llm") };
}

function toConfig(seat: Seat): PlayerConfig {
  switch (seat.kind) {
    case "human":
      return { kind: "human" };
    case "stockfish":
      return { kind: "stockfish", skill: seat.skill };
    case "llm":
      return {
        kind: "llm",
        model: seat.customModel.trim() || seat.model,
        persona: seat.persona,
        showLegalMoves: seat.showLegalMoves,
        ...(seat.reasoning && { reasoning: seat.reasoning }),
      };
  }
}

const price = (m: ModelInfo) =>
  m.promptPrice === 0 && m.completionPrice === 0
    ? "free"
    : `$${m.promptPrice}/$${m.completionPrice} per M`;

export function Setup({ onStart }: { onStart: (id: string) => void }) {
  const [seats, setSeats] = useState(loadSeats);
  const [catalog, setCatalog] = useState<{
    models: ModelInfo[];
    recommended: string[];
    live: boolean;
  } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.models().then(setCatalog, (e: Error) => setError(e.message));
    api.health().then(setHealth, () => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seats));
    } catch {
      // storage may be unavailable
    }
  }, [seats]);

  const update = (color: Color, patch: Partial<Seat>) =>
    setSeats((s) => ({ ...s, [color]: { ...s[color], ...patch } }));

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const game = await api.createGame(toConfig(seats.w), toConfig(seats.b));
      onStart(game.id);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  const usesLlm = seats.w.kind === "llm" || seats.b.kind === "llm";
  return (
    <section className="setup">
      <h1>Pick your fighters</h1>
      <p className="muted">
        Every move is graded by Stockfish. Watch the AI think, scheme and occasionally hallucinate a
        queen.
      </p>
      {health && !health.openrouter && usesLlm && (
        <div className="banner warn">
          The server has no <code>OPENROUTER_API_KEY</code>, so only the offline Random mover will
          work. Add the key to <code>.env</code> and restart.
        </div>
      )}
      {catalog && !catalog.live && (
        <div className="banner">
          Couldn't reach OpenRouter for the live model list. Showing the built-in picks.
        </div>
      )}
      <div className="seats">
        {(["w", "b"] as const).map((color) => (
          <SeatCard
            key={color}
            color={color}
            seat={seats[color]}
            catalog={catalog}
            onChange={(p) => update(color, p)}
          />
        ))}
      </div>
      <div className="setup-actions">
        <button className="button ghost" onClick={() => setSeats((s) => ({ w: s.b, b: s.w }))}>
          ⇄ Swap colours
        </button>
        <button className="button primary big" disabled={starting} onClick={start}>
          {starting ? "Setting up the board…" : "Start game"}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}

function SeatCard({
  color,
  seat,
  catalog,
  onChange,
}: {
  color: Color;
  seat: Seat;
  catalog: { models: ModelInfo[]; recommended: string[] } | null;
  onChange: (patch: Partial<Seat>) => void;
}) {
  const models = catalog?.models ?? [];
  const byId = new Map(models.map((m) => [m.id, m]));
  const recommended = (catalog?.recommended ?? [])
    .map((id) => byId.get(id))
    .filter((m): m is ModelInfo => !!m);
  const chosen = byId.get(seat.customModel.trim() || seat.model);

  return (
    <div className={`seat seat-${color}`}>
      <h2>
        <span className="seat-piece">{color === "w" ? "♔" : "♚"}</span>{" "}
        {color === "w" ? "White" : "Black"}
      </h2>
      <div className="segmented" role="radiogroup">
        {(
          [
            ["human", "🧑 You"],
            ["llm", "🤖 LLM"],
            ["stockfish", "🐟 Stockfish"],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={kind}
            role="radio"
            aria-checked={seat.kind === kind}
            className={seat.kind === kind ? "active" : ""}
            onClick={() => onChange({ kind })}
          >
            {label}
          </button>
        ))}
      </div>

      {seat.kind === "llm" && (
        <div className="fields">
          <label>
            Model
            <select
              value={seat.model}
              onChange={(e) => onChange({ model: e.target.value, customModel: "" })}
            >
              {!byId.has(seat.model) && <option value={seat.model}>{seat.model}</option>}
              {recommended.length > 0 && (
                <optgroup label="Recommended cheap models">
                  {recommended.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {price(m)}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={`All tool-capable models (${models.length}), cheapest first`}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {price(m)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            …or any OpenRouter model id
            <input
              placeholder="e.g. openai/gpt-5-nano"
              value={seat.customModel}
              onChange={(e) => onChange({ customModel: e.target.value })}
            />
          </label>
          <div className="row">
            <label>
              Personality
              <select
                value={seat.persona}
                onChange={(e) => onChange({ persona: e.target.value as PersonaId })}
              >
                {Object.entries(PERSONAS).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reasoning
              <select
                value={seat.reasoning}
                onChange={(e) => onChange({ reasoning: e.target.value as Seat["reasoning"] })}
                disabled={chosen ? !chosen.reasoning : false}
              >
                <option value="">Model default</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={seat.showLegalMoves}
              onChange={(e) => onChange({ showLegalMoves: e.target.checked })}
            />
            Training wheels: show the AI its legal moves
          </label>
          {chosen && (
            <p className="hint">
              ≈ {formatUsd(estimateGameCost(chosen, Boolean(seat.reasoning)))} per 40-move game
            </p>
          )}
        </div>
      )}

      {seat.kind === "stockfish" && (
        <div className="fields">
          <label>
            Skill level: <strong>{seat.skill}</strong> / 20
            <input
              type="range"
              min={0}
              max={20}
              value={seat.skill}
              onChange={(e) => onChange({ skill: Number(e.target.value) })}
            />
          </label>
          <p className="hint">Level 0 still beats most LLMs. Level 20 beats everyone.</p>
        </div>
      )}

      {seat.kind === "human" && (
        <div className="fields">
          <p className="hint">Drag or click pieces to move. Hints are counted. 😏</p>
        </div>
      )}
    </div>
  );
}
