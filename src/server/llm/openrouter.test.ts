import { describe, expect, it } from "vitest";
import { OpenRouterClient } from "./openrouter";
import type { CompletionRequest } from "./types";

const req: CompletionRequest = {
  model: "acme/bot",
  messages: [{ role: "user", content: "your move" }],
  tools: [{ name: "make_move", description: "move", parameters: { type: "object" } }],
  reasoning: "low",
};

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const ok = () =>
  json({
    choices: [
      {
        message: {
          content: " thinking aloud ",
          reasoning: "deep thoughts",
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "make_move", arguments: '{"move":"e4"}' },
            },
          ],
        },
      },
    ],
    usage: { total_tokens: 321, cost: 0.00042 },
  });

const client = (f: typeof fetch) =>
  new OpenRouterClient({
    apiKey: "sk-test",
    baseUrl: "https://example.test/v1/",
    fetch: f,
    retryDelaysMs: [1, 1],
  });

describe("OpenRouterClient", () => {
  it("sends an OpenAI-style tool request and parses the reply", async () => {
    const { fn, calls } = fakeFetch(ok());
    const res = await client(fn).complete(req);

    expect(calls[0]!.url).toBe("https://example.test/v1/chat/completions");
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer sk-test" });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({
      model: "acme/bot",
      tool_choice: "auto",
      usage: { include: true },
      reasoning: { effort: "low" },
      tools: [{ type: "function", function: { name: "make_move" } }],
    });
    expect(res).toEqual({
      content: "thinking aloud",
      reasoning: "deep thoughts",
      toolCalls: [{ id: "c1", name: "make_move", arguments: '{"move":"e4"}' }],
      costUsd: 0.00042,
      tokens: 321,
    });
  });

  it("omits reasoning unless asked", async () => {
    const { fn, calls } = fakeFetch(ok());
    await client(fn).complete({ ...req, reasoning: undefined });
    expect(JSON.parse(calls[0]!.init.body as string)).not.toHaveProperty("reasoning");
  });

  it("retries rate limits, server errors and network failures", async () => {
    const { fn, calls } = fakeFetch(
      json({ error: { message: "slow down" } }, 429),
      new Error("ECONNRESET"),
      ok(),
    );
    const res = await client(fn).complete(req);
    expect(calls).toHaveLength(3);
    expect(res.tokens).toBe(321);
  });

  it("gives up after the retry budget", async () => {
    const { fn } = fakeFetch(
      json({}, 503),
      json({}, 503),
      json({ error: { message: "still down" } }, 503),
    );
    await expect(client(fn).complete(req)).rejects.toThrow("still down");
  });

  it("does not retry client errors, and surfaces provider errors hidden in 200s", async () => {
    const auth = fakeFetch(json({ error: { message: "No auth credentials found" } }, 401));
    await expect(client(auth.fn).complete(req)).rejects.toThrow(
      "acme/bot: No auth credentials found",
    );
    expect(auth.calls).toHaveLength(1);

    const hidden = fakeFetch(json({ error: { message: "Provider returned error", code: 400 } }));
    await expect(client(hidden.fn).complete(req)).rejects.toThrow("Provider returned error");
  });

  it("times out a call that never answers, without retrying", async () => {
    let calls = 0;
    const hang = (async (_url: string, init: RequestInit) => {
      calls++;
      return new Promise((_, reject) =>
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
      );
    }) as unknown as typeof fetch;
    const slow = new OpenRouterClient({
      apiKey: "k",
      fetch: hang,
      timeoutMs: 20,
      retryDelaysMs: [1],
    });
    await expect(slow.complete(req)).rejects.toThrow("no reply after 0.02s");
    expect(calls).toBe(1);
  });

  it("fails fast without an API key", async () => {
    const { fn, calls } = fakeFetch(ok());
    await expect(
      new OpenRouterClient({ apiKey: undefined, fetch: fn }).complete(req),
    ).rejects.toThrow("OPENROUTER_API_KEY");
    expect(calls).toHaveLength(0);
  });
});
