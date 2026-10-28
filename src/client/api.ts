import { useEffect, useState } from "react";
import type {
  Action,
  ActionResponse,
  GameSnapshot,
  Health,
  ModelInfo,
  PlayerConfig,
} from "../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const api = {
  health: () => request<Health>("/api/health"),
  models: () =>
    request<{ models: ModelInfo[]; recommended: string[]; live: boolean }>("/api/models"),
  createGame: (white: PlayerConfig, black: PlayerConfig) =>
    request<GameSnapshot>("/api/games", { method: "POST", body: JSON.stringify({ white, black }) }),
  act: (id: string, action: Action) =>
    request<ActionResponse>(`/api/games/${id}/actions`, {
      method: "POST",
      body: JSON.stringify(action),
    }),
};

/** Live game state over SSE. EventSource reconnects on its own. */
export function useGame(id: string) {
  const [game, setLatest] = useState<GameSnapshot | null>(null);
  const [missing, setMissing] = useState(false);
  // HTTP responses and SSE events can arrive out of order: keep the newest.
  const setGame = (next: GameSnapshot) =>
    setLatest((prev) => (prev?.id === next.id && prev.version > next.version ? prev : next));

  useEffect(() => {
    setLatest(null);
    setMissing(false);
    const source = new EventSource(`/api/games/${id}/stream`);
    source.addEventListener("snapshot", (e) =>
      setGame(JSON.parse((e as MessageEvent<string>).data)),
    );
    source.onerror = () => {
      // A 404 closes the stream for good; a dropped connection retries.
      if (source.readyState === EventSource.CLOSED) setMissing(true);
    };
    return () => source.close();
  }, [id]);

  return { game, missing, setGame };
}

/** Minimal hash router: "#/game/<id>" or the setup screen. */
export function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  const gameId = /^#\/game\/([\w-]+)/.exec(hash)?.[1] ?? null;
  return { gameId, go: (path: string) => (location.hash = path) };
}
