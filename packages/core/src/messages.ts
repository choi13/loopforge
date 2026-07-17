/**
 * Provider-neutral conversation format, mirroring Anthropic-style content
 * blocks. The loop builds history in this shape; each provider maps it to its
 * own wire format.
 */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}
