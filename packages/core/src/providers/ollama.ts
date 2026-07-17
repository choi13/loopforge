import type { ChatMessage } from "../messages";
import type { ModelProvider, ModelRequest, ModelTurn } from "../provider";
import type { ToolDefinition } from "../tools";

/**
 * Local-model provider backed by Ollama — no API key, no cost.
 *
 * The small local models here only advertise `completion` (no native tool
 * calling), so this provider uses a ReAct-style adapter: it augments the
 * system prompt with the tool list and a strict JSON action format, then
 * parses the model's text back into a single tool call per turn. That makes
 * any Ollama completion model drivable by the same agent loop.
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
      { role: "system", content: buildSystemPrompt(request.system, request.tools) },
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

    const usage = {
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
    };

    const action = parseAction(content);
    if (action && action.tool !== "final") {
      return {
        text: action.thought,
        toolCalls: [
          {
            id: `toolu_ollama_${Date.now().toString(36)}_${Math.floor(usage.outputTokens)}`,
            name: action.tool,
            input: action.input,
          },
        ],
        usage,
      };
    }

    // No tool call (or an explicit "final") ends the run.
    const finalText =
      action?.tool === "final"
        ? (typeof action.input?.answer === "string" ? action.input.answer : action.thought)
        : stripActionNoise(content);
    return { text: finalText || content, toolCalls: [], usage };
  }
}

function buildSystemPrompt(base: string, tools: ToolDefinition[]): string {
  const toolLines = tools
    .map((t) => {
      const props = (t.inputSchema.properties as Record<string, unknown>) ?? {};
      const args = Object.keys(props).join(", ") || "(no arguments)";
      return `- ${t.name}(${args}): ${t.description}`;
    })
    .join("\n");

  return [
    base,
    "",
    "You act by calling ONE tool at a time. You have these tools:",
    toolLines,
    "",
    "On every turn, respond with a SINGLE JSON object and nothing else:",
    '  {"tool": "<tool_name>", "input": { <arguments> }}',
    "When the task is fully done, respond with:",
    '  {"tool": "final", "input": {"answer": "<one-sentence summary>"}}',
    "",
    "Rules:",
    "- Output ONLY the JSON object. No prose, no markdown fences, no explanation before or after.",
    "- Use exactly the tool names listed above.",
    "- Take one step at a time; you will see each tool's result before your next turn.",
  ].join("\n");
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

interface ParsedAction {
  tool: string;
  input: Record<string, any>;
  thought?: string;
}

/** Extract a {tool, input} action from possibly-noisy model text. */
function parseAction(content: string): ParsedAction | null {
  const stripped = content.replace(/```(?:json)?/gi, "").trim();

  // Try each balanced top-level {...} candidate, first that parses to an action.
  for (const candidate of extractJsonObjects(stripped)) {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj.tool === "string") {
        return {
          tool: obj.tool,
          input: obj.input && typeof obj.input === "object" ? obj.input : {},
          thought: textBefore(stripped, candidate),
        };
      }
    } catch {
      // keep scanning
    }
  }
  return null;
}

/** Return balanced {...} substrings, scanning left to right, longest-first per start. */
function extractJsonObjects(text: string): string[] {
  const objects: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          objects.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return objects;
}

function textBefore(full: string, candidate: string): string | undefined {
  const idx = full.indexOf(candidate);
  const before = idx > 0 ? full.slice(0, idx).trim() : "";
  return before || undefined;
}

/** Best-effort plain text when the model produced no valid action. */
function stripActionNoise(content: string): string {
  return content.replace(/```(?:json)?/gi, "").trim();
}
