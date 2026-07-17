import type { ModelProvider, ModelRequest, ModelTurn } from "../provider";

/**
 * Scripted provider for demos and tests. Each complete() call pops the next
 * step, with a small delay for streaming realism. Tool calls it emits are
 * executed for real by the loop — so a well-written script produces a
 * genuinely working end-to-end run without an API key.
 */

export interface MockStep {
  thinking?: string;
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
  delayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MockProvider implements ModelProvider {
  readonly name = "mock";
  readonly model = "mock-scripted";
  private cursor = 0;

  constructor(
    private readonly steps: MockStep[],
    private readonly defaultDelayMs = 700,
  ) {}

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const step: MockStep =
      this.steps[this.cursor] ?? { text: "Mock script exhausted — ending run." };
    this.cursor += 1;
    await sleep(step.delayMs ?? this.defaultDelayMs);

    // Plausible token accounting so the dashboard has something to show.
    const approxInputChars = request.messages.reduce(
      (sum, message) => sum + JSON.stringify(message.content).length,
      request.system.length,
    );
    const approxOutputChars =
      (step.thinking?.length ?? 0) +
      (step.text?.length ?? 0) +
      JSON.stringify(step.toolCalls ?? []).length;

    return {
      thinking: step.thinking,
      text: step.text,
      toolCalls: (step.toolCalls ?? []).map((call, index) => ({
        id: `toolu_mock_${this.cursor}_${index}`,
        name: call.name,
        input: call.input,
      })),
      usage: {
        inputTokens: Math.ceil(approxInputChars / 4),
        outputTokens: Math.ceil(approxOutputChars / 4),
      },
    };
  }
}
