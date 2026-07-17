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
}

export interface ModelTurn {
  thinking?: string;
  /** Opaque signature required to replay thinking blocks to the Claude API. */
  thinkingSignature?: string;
  text?: string;
  toolCalls: ToolCallRef[];
  usage: TokenUsage;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelTurn>;
}
