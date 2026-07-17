import type { ChatMessage } from "../messages";
import type { ModelProvider, ModelRequest, ModelTurn } from "../provider";
import { buildReactSystemPrompt, reactActionToTurn } from "./react";

/**
 * Local-model provider backed by Ollama — no API key, no cost.
 *
 * The small local models here only advertise `completion` (no native tool
 * calling), so this provider uses the shared ReAct adapter: it augments the
 * system prompt with the tool list and a strict JSON action format, then
 * parses the model's text back into a single tool call per turn.
 */

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";

  constructor(
    readonly model: string = "llama3:latest",
    private readonly baseUrl: string = "http://localhost:11434",
  ) {}

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const messages: OllamaMessage[] = [
      { role: "system", content: buildReactSystemPrompt(request.system, request.tools) },
      ...request.messages.map(toOllamaMessage),
    ];

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        // Low temperature for steadier format adherence from small models.
        options: { temperature: 0.2, num_ctx: 8192 },
        messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as OllamaChatResponse;
    const content = data.message?.content ?? "";

    return reactActionToTurn(content, {
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
    });
  }
}

function toOllamaMessage(message: ChatMessage): OllamaMessage {
  if (message.role === "assistant") {
    // Re-encode the assistant turn as the JSON action it took (plus any text),
    // so the model sees its own prior actions in the format it must produce.
    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === "text" && block.text) parts.push(block.text);
      else if (block.type === "tool_use") {
        parts.push(JSON.stringify({ tool: block.name, input: block.input }));
      }
    }
    return { role: "assistant", content: parts.join("\n") || "{}" };
  }

  // user turn: plain text, or tool results rendered as observations.
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "tool_result") {
      const tag = block.isError ? "Observation (error)" : "Observation";
      parts.push(`${tag}:\n${block.content}`);
    }
  }
  return { role: "user", content: parts.join("\n\n") };
}
