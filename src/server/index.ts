import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { createApp } from "./app";
import { createDeps, loadConfig } from "./deps";
import { GameStore } from "./game/store";
import { createModelCatalog } from "./llm/models";

const config = loadConfig();
const deps = createDeps(config);
const app = createApp({
  store: new GameStore(deps),
  models: createModelCatalog({ baseUrl: config.baseUrl }),
  health: () => ({ openrouter: Boolean(config.apiKey), stockfish: true }),
});

const clientDir = "dist/client";
if (process.env.NODE_ENV === "production") {
  if (!existsSync(clientDir)) console.warn(`${clientDir} is missing: run "npm run build" first`);
  app.use("/*", serveStatic({ root: clientDir }));
  app.get("*", serveStatic({ path: `${clientDir}/index.html` }));
}

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`♟  Chess harness API on http://localhost:${port}`);
  if (!config.apiKey)
    console.warn("OPENROUTER_API_KEY is not set: only the offline random mover will work.");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void deps.shutdown();
    server.close();
    process.exit(0);
  });
}
