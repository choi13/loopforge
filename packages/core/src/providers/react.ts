import type { ChatMessage } from "../messages";
import type { ModelTurn } from "../provider";
import type { ToolDefinition } from "../tools";

/**
 * Shared ReAct adapter for providers whose backing model has no native
 * tool-calling: the model is asked to emit ONE tool call per turn as a JSON
 * object, which is parsed back into a ModelTurn. Used by both the local Ollama
 * provider and the Claude CLI provider.
 */

export interface ParsedAction {
  tool: string;
  input: Record<string, any>;
  thought?: string;
}

export interface ReactPromptOptions {
  /**
   * "Planner" framing for capable models (e.g. Claude via the CLI) that would
   * otherwise try to invoke the tools for real and then break format to flag
   * that they can't. It makes explicit that the model has no tools and only
   * emits JSON for an external harness to execute.
   */
  planner?: boolean;
}

/** Augment an environment's system prompt with the tool list and JSON format. */
export function buildReactSystemPrompt(
  base: string,
  tools: ToolDefinition[],
  opts: ReactPromptOptions = {},
): string {
  const toolLines = tools
    .map((t) => {
      const props = (t.inputSchema.properties as Record<string, unknown>) ?? {};
      const args = Object.keys(props).join(", ") || "(no arguments)";
      return `- ${t.name}(${args}): ${t.description}`;
    })
    .join("\n");

  const intro = opts.planner
    ? [
        "You are the planning module inside an agent harness. You do NOT have tools",
        "and never execute anything yourself. Each turn you emit ONE JSON action; an",
        "external harness runs it and returns the result to you as an Observation.",
        "The tools the harness can run for you:",
      ]
    : ["You act by calling ONE tool at a time. You have these tools:"];

  const rules = [
    "Rules:",
    "- Output ONLY the JSON object. No prose, no markdown fences, no explanation before or after.",
    "- Use exactly the tool names listed above.",
    "- Take one step at a time; you will see each tool's result before your next turn.",
  ];
  if (opts.planner) {
    rules.push(
      "- Never try to call a tool directly and never break format to comment on the setup — just output the JSON action.",
    );
  }

  return [
    base,
    "",
    ...intro,
    toolLines,
    "",
    "On every turn, respond with a SINGLE JSON object and nothing else:",
    '  {"tool": "<tool_name>", "input": { <arguments> }}',
    "When the task is fully done, respond with:",
    '  {"tool": "final", "input": {"answer": "<one-sentence summary>"}}',
    "",
    ...rules,
  ].join("\n");
}

/**
 * Render the conversation as a single flat transcript, for providers that take
 * one prompt string (e.g. a CLI). Assistant turns show the JSON action they
 * took; tool results become labeled observations.
 */
export function renderReactTranscript(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      const chunks: string[] = [];
      for (const block of message.content) {
        if (block.type === "text" && block.text) chunks.push(block.text);
        else if (block.type === "tool_use") {
          chunks.push(JSON.stringify({ tool: block.name, input: block.input }));
        }
      }
      if (chunks.length) parts.push(`Assistant:\n${chunks.join("\n")}`);
    } else {
      for (const block of message.content) {
        if (block.type === "text") parts.push(block.text);
        else if (block.type === "tool_result") {
          const tag = block.isError ? "Observation (error)" : "Observation";
          parts.push(`${tag}:\n${block.content}`);
        }
      }
    }
  }
  parts.push("Your next action (JSON only):");
  return parts.join("\n\n");
}

let actionCounter = 0;

/**
 * Turn a model's raw text response into a ModelTurn: a single tool call if it
 * emitted a valid action, otherwise a final text answer that ends the run.
 */
export function reactActionToTurn(
  content: string,
  usage: ModelTurn["usage"],
): ModelTurn {
  const action = parseReactAction(content);
  if (action && action.tool !== "final") {
    actionCounter += 1;
    return {
      text: action.thought,
      toolCalls: [
        {
          id: `toolu_react_${Date.now().toString(36)}_${actionCounter}`,
          name: action.tool,
          input: action.input,
        },
      ],
      usage,
    };
  }

  const finalText =
    action?.tool === "final"
      ? typeof action.input?.answer === "string"
        ? action.input.answer
        : action.thought
      : stripFences(content);
  return { text: finalText || content, toolCalls: [], usage };
}

/** Extract a {tool, input} action from possibly-noisy model text. */
export function parseReactAction(content: string): ParsedAction | null {
  const stripped = stripFences(content);
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

function stripFences(content: string): string {
  return content.replace(/```(?:json)?/gi, "").trim();
}

/** Balanced {...} substrings, scanning left to right. */
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
