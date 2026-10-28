import { describe, expect, it } from "vitest";
import type { ActionResponse, GameSnapshot } from "../shared/types";
import { createApp } from "./app";
import { GameStore } from "./game/store";
import { deps, move, ScriptedLlm } from "./test/fakes";

function setup() {
  const llm = new ScriptedLlm([move("e5"), move("Nc6")]);
  const app = createApp({
    store: new GameStore(deps({ llm })),
    models: async () => ({ models: [], recommended: [], live: false }),
    health: () => ({ openrouter: false, stockfish: true }),
  });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  return { app, post, llm };
}

const humanVsBot = {
  white: { kind: "human" },
  black: { kind: "llm", model: "acme/bot", persona: "pirate" },
};

describe("HTTP API", () => {
  it("creates a game with defaults filled in and serves its snapshot", async () => {
    const { app, post } = setup();
    const res = await post("/api/games", humanVsBot);
    expect(res.status).toBe(201);
    const created = (await res.json()) as GameSnapshot;
    expect(created.players.b.config).toEqual({
      kind: "llm",
      model: "acme/bot",
      persona: "pirate",
      showLegalMoves: true,
    });

    const fetched = (await (await app.request(`/api/games/${created.id}`)).json()) as GameSnapshot;
    expect(fetched.id).toBe(created.id);
  });

  it("validates new games", async () => {
    const { post } = setup();
    const bad = await post("/api/games", {
      white: { kind: "stockfish", skill: 99 },
      black: { kind: "human" },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("skill");
    expect(
      (await post("/api/games", { white: { kind: "llm" }, black: { kind: "human" } })).status,
    ).toBe(400);
  });

  it("applies actions and reports rule violations as 400s", async () => {
    const { post } = setup();
    const { id } = (await (await post("/api/games", humanVsBot)).json()) as GameSnapshot;

    const ok = await post(`/api/games/${id}/actions`, { type: "move", move: "e4" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as ActionResponse).snapshot.moves[0]!.san).toBe("e4");

    const illegal = await post(`/api/games/${id}/actions`, { type: "move", move: "Qxh9" });
    expect(illegal.status).toBe(400);
    expect(await illegal.json()).toEqual({
      error: expect.stringMatching(/Illegal move|not your turn/),
    });

    expect((await post(`/api/games/${id}/actions`, { type: "teleport" })).status).toBe(400);
  });

  it("returns 404 for unknown games and 400 for broken JSON", async () => {
    const { app } = setup();
    expect((await app.request("/api/games/nope")).status).toBe(404);
    const res = await app.request("/api/games", { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
  });

  it("streams snapshots over SSE", async () => {
    const { app, post } = setup();
    const { id } = (await (await post("/api/games", humanVsBot)).json()) as GameSnapshot;
    const res = await app.request(`/api/games/${id}/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: snapshot");
    expect(first).toContain(`"id":"${id}"`);

    await post(`/api/games/${id}/actions`, { type: "move", move: "d4" });
    let text = "";
    while (!text.includes('"san":"d4"'))
      text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
  });

  it("exposes health and models", async () => {
    const { app } = setup();
    expect(await (await app.request("/api/health")).json()).toEqual({
      openrouter: false,
      stockfish: true,
    });
    expect(await (await app.request("/api/models")).json()).toMatchObject({ live: false });
  });
});
