import type { TokenUsage, ToolCallRef } from "./events";
import type { ChatMessage } from "./messages";
import type { ToolDefinition } from "./tools";

/**
 * A ModelProvider produces one assistant turn per call. The loop owns the
 * conversation state and the tool execution; providers only translate a
 * request into a completion.
 */

export interface ModelRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** Aborts an in-flight completion when the run is aborted. */
  signal?: AbortSignal;
}

export interface ModelTurn {
  /** Concatenated thinking text, for display in the trace only. */
  thinking?: string;
  /**
   * The raw thinking blocks exactly as returned, preserved for faithful replay
   * to the Claude API. When thinking is enabled and a turn makes tool calls,
   * these blocks (with their signatures) must be sent back unchanged on the
   * next request, or the API rejects the continuation.
   */
  thinkingBlocks?: { thinking: string; signature: string }[];
  text?: string;
  toolCalls: ToolCallRef[];
  usage: TokenUsage;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelTurn>;
}
