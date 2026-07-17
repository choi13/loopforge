import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "../messages";
import type { ModelProvider, ModelRequest, ModelTurn } from "../provider";

/**
 * Real provider backed by the Claude API. Requires ANTHROPIC_API_KEY in the
 * environment. Uses adaptive thinking with summarized display so the
 * dashboard can render the model's reasoning.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(readonly model: string = "claude-opus-4-8") {
    this.client = new Anthropic();
  }

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: "adaptive", display: "summarized" },
      system: request.system,
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
      })),
      messages: request.messages.map(toAnthropicMessage),
    });

    const turn: ModelTurn = {
      toolCalls: [],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };

    for (const block of response.content) {
      if (block.type === "thinking") {
        if (block.thinking) {
          turn.thinking = (turn.thinking ?? "") + block.thinking;
        }
        turn.thinkingSignature = block.signature;
      } else if (block.type === "text") {
        turn.text = (turn.text ?? "") + block.text;
      } else if (block.type === "tool_use") {
        turn.toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    if (response.stop_reason === "refusal") {
      turn.text = turn.text || "The model declined this request for safety reasons.";
      turn.toolCalls = [];
    }

    return turn;
  }
}

function toAnthropicMessage(message: ChatMessage): Anthropic.MessageParam {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      // Thinking blocks may only be replayed with their original signature.
      if (block.signature) {
        content.push({
          type: "thinking",
          thinking: block.thinking,
          signature: block.signature,
        });
      }
    } else if (block.type === "tool_use") {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      });
    } else {
      content.push({
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError ?? false,
      });
    }
  }
  return { role: message.role, content };
}
