import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { PERSONAS } from "../shared/personas";
import type { GameSnapshot, Health, ModelInfo, PersonaId } from "../shared/types";
import { ActionError } from "./game/session";
import type { GameStore } from "./game/store";

const PlayerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human"), name: z.string().max(40).optional() }),
  z.object({
    kind: z.literal("llm"),
    model: z.string().min(1).max(200),
    persona: z.enum(Object.keys(PERSONAS) as [PersonaId, ...PersonaId[]]).default("trash_talker"),
    showLegalMoves: z.boolean().default(true),
    reasoning: z.enum(["low", "medium", "high"]).optional(),
  }),
  z.object({ kind: z.literal("stockfish"), skill: z.number().int().min(0).max(20) }),
]);

const NewGameSchema = z.object({ white: PlayerSchema, black: PlayerSchema });

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), move: z.string().min(1).max(20) }),
  z.object({ type: z.literal("chat"), text: z.string().min(1).max(500) }),
  ...(["resign", "offer_draw", "accept_draw", "decline_draw", "hint", "retry"] as const).map(
    (type) => z.object({ type: z.literal(type) }),
  ),
]);

export interface AppDeps {
  store: GameStore;
  models: () => Promise<{ models: ModelInfo[]; recommended: string[]; live: boolean }>;
  health: () => Health;
}

export function createApp({ store, models, health }: AppDeps) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ActionError) return c.json({ error: err.message }, 400);
    if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON body" }, 400);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

  const session = (c: Context) => {
    const s = store.get(c.req.param("id") ?? "");
    if (!s) throw new HTTPException(404, { message: "Game not found" });
    return s;
  };

  app.get("/api/health", (c) => c.json(health()));
  app.get("/api/models", async (c) => c.json(await models()));

  app.post("/api/games", async (c) => {
    const body = NewGameSchema.parse(await c.req.json());
    return c.json(store.create({ w: body.white, b: body.black }).snapshot(), 201);
  });

  app.get("/api/games/:id", (c) => c.json(session(c).snapshot()));

  app.post("/api/games/:id/actions", async (c) => {
    const game = session(c);
    return c.json(await game.act(ActionSchema.parse(await c.req.json())));
  });

  // Every change pushes a full snapshot. Bursts are coalesced to the latest one.
  app.get("/api/games/:id/stream", (c) => {
    const game = session(c);
    return streamSSE(c, async (stream) => {
      let pending: GameSnapshot | null = null;
      let writing = false;
      const send = async (snap: GameSnapshot) => {
        pending = snap;
        if (writing) return;
        writing = true;
        while (pending && !stream.aborted) {
          const next: GameSnapshot = pending;
          pending = null;
          await stream.writeSSE({ event: "snapshot", data: JSON.stringify(next) });
        }
        writing = false;
      };
      const off = game.subscribe((snap) => void send(snap));
      const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 20_000);
      await send(game.snapshot());
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      off();
      clearInterval(ping);
    });
  });

  return app;
}
