import { randomUUID } from "node:crypto";
import type { Color, PlayerConfig } from "../../shared/types";
import { GameSession, type SessionDeps } from "./session";

/** In-memory games. The oldest are dropped past `max`. */
export class GameStore {
  private readonly games = new Map<string, GameSession>();
  private readonly deps: SessionDeps;
  private readonly max: number;

  constructor(deps: SessionDeps, max = 50) {
    this.deps = deps;
    this.max = max;
  }

  create(players: Record<Color, PlayerConfig>): GameSession {
    const session = new GameSession(randomUUID().slice(0, 8), players, this.deps);
    this.games.set(session.id, session);
    for (const [id, old] of this.games) {
      if (this.games.size <= this.max) break;
      old.dispose();
      this.games.delete(id);
    }
    session.start();
    return session;
  }

  get(id: string): GameSession | undefined {
    return this.games.get(id);
  }
}
