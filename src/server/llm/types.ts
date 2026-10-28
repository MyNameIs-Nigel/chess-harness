import type { ReasoningEffort } from "../../shared/types";

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as the model produced it. */
  arguments: string;
}

/** OpenAI-compatible chat message. */
export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  reasoning?: ReasoningEffort;
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string | null;
  reasoning: string | null;
  toolCalls: ToolCall[];
  costUsd: number;
  tokens: number;
}

export interface LlmClient {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class LlmError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}
