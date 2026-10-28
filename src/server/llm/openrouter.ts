import {
  LlmError,
  type CompletionRequest,
  type CompletionResult,
  type LlmClient,
  type WireToolCall,
} from "./types";

export interface OpenRouterOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Delays between retries of retryable failures (429, 5xx, network). */
  retryDelaysMs?: number[];
  maxTokens?: number;
}

interface WireResponse {
  error?: { message?: string; code?: number };
  choices?: {
    message?: { content?: string | null; reasoning?: string | null; tool_calls?: WireToolCall[] };
    error?: { message?: string };
  }[];
  usage?: { total_tokens?: number; cost?: number };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), {
      once: true,
    });
  });

/** Minimal OpenAI-compatible chat client, tuned for OpenRouter (cost accounting, reasoning). */
export class OpenRouterClient implements LlmClient {
  private readonly opts: OpenRouterOptions;
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly retryDelaysMs: number[];

  constructor(opts: OpenRouterOptions) {
    this.opts = opts;
    this.baseUrl = (opts.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.fetch = opts.fetch ?? fetch;
    this.retryDelaysMs = opts.retryDelaysMs ?? [1000, 3000];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(req);
      } catch (err) {
        const delay = this.retryDelaysMs[attempt];
        if (!(err instanceof LlmError && err.retryable) || delay === undefined) throw err;
        await sleep(delay, req.signal);
      }
    }
  }

  private async once(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.opts.apiKey) throw new LlmError("OPENROUTER_API_KEY is not set on the server");
    const body = {
      model: req.model,
      messages: req.messages,
      tools: req.tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      max_tokens: this.opts.maxTokens ?? 4096,
      usage: { include: true },
      ...(req.reasoning && { reasoning: { effort: req.reasoning } }),
    };
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/mynameis-nigel/chess-harness",
          "X-Title": "LLM Chess Harness",
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      if (req.signal?.aborted) throw err;
      throw new LlmError(`Network error: ${(err as Error).message}`, true);
    }

    const text = await res.text();
    let data: WireResponse;
    try {
      data = JSON.parse(text) as WireResponse;
    } catch {
      throw new LlmError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status >= 500);
    }
    const errorMessage = data.error?.message ?? data.choices?.[0]?.error?.message;
    if (!res.ok || errorMessage) {
      const status = res.ok ? (data.error?.code ?? 502) : res.status;
      throw new LlmError(
        `${req.model}: ${errorMessage ?? `HTTP ${status}`}`,
        status === 429 || status >= 500,
      );
    }

    const message = data.choices?.[0]?.message;
    if (!message) throw new LlmError(`${req.model}: empty response`, true);
    return {
      content: message.content?.trim() || null,
      reasoning: message.reasoning?.trim() || null,
      toolCalls: (message.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: c.function.arguments ?? "",
      })),
      costUsd: data.usage?.cost ?? 0,
      tokens: data.usage?.total_tokens ?? 0,
    };
  }
}
