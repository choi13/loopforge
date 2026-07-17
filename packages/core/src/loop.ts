import type { RunStatus, TokenUsage, TraceEvent } from "./events";
import type { ChatMessage, ContentBlock } from "./messages";
import type { ModelProvider } from "./provider";
import type { Tool } from "./tools";

/**
 * The agent loop: observe → reason → act → verify, until the model stops
 * calling tools or a limit is hit. Every step is emitted as a TraceEvent so
 * the harness around it can watch the loop breathe.
 */

export interface AgentLoopOptions {
  provider: ModelProvider;
  tools: Tool[];
  systemPrompt: string;
  /** Safety valve against runaway loops. Default 20. */
  maxIterations?: number;
  onEvent: (event: TraceEvent) => void;
}

export interface RunResult {
  status: Exclude<RunStatus, "running">;
  finalText?: string;
  error?: string;
  iterations: number;
  totalUsage: TokenUsage;
}

export class AgentLoop {
  constructor(private readonly opts: AgentLoopOptions) {}

  async run(runId: string, task: string, signal?: AbortSignal): Promise<RunResult> {
    const { provider, tools, systemPrompt, onEvent } = this.opts;
    const maxIterations = this.opts.maxIterations ?? 20;
    const startedAt = Date.now();
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const toolDefs = tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: task }] },
    ];

    let iteration = 0;

    const finish = (
      status: RunResult["status"],
      extra: { finalText?: string; error?: string } = {},
    ): RunResult => {
      onEvent({
        type: "run_finished",
        runId,
        status,
        finalText: extra.finalText,
        error: extra.error,
        iterations: iteration,
        totalUsage,
        durationMs: Date.now() - startedAt,
        at: Date.now(),
      });
      return { status, ...extra, iterations: iteration, totalUsage };
    };

    onEvent({
      type: "run_started",
      runId,
      task,
      provider: provider.name,
      model: provider.model,
      at: Date.now(),
    });

    try {
      while (iteration < maxIterations) {
        iteration += 1;
        if (signal?.aborted) return finish("aborted");

        onEvent({ type: "iteration_started", runId, iteration, at: Date.now() });
        onEvent({
          type: "model_request",
          runId,
          iteration,
          messageCount: messages.length,
          at: Date.now(),
        });

        const turn = await provider.complete({
          system: systemPrompt,
          messages,
          tools: toolDefs,
        });
        totalUsage.inputTokens += turn.usage.inputTokens;
        totalUsage.outputTokens += turn.usage.outputTokens;

        onEvent({
          type: "model_response",
          runId,
          iteration,
          thinking: turn.thinking,
          text: turn.text,
          toolCalls: turn.toolCalls,
          usage: turn.usage,
          at: Date.now(),
        });

        const assistantContent: ContentBlock[] = [];
        if (turn.thinking && turn.thinkingSignature) {
          assistantContent.push({
            type: "thinking",
            thinking: turn.thinking,
            signature: turn.thinkingSignature,
          });
        }
        if (turn.text) {
          assistantContent.push({ type: "text", text: turn.text });
        }
        for (const call of turn.toolCalls) {
          assistantContent.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.input,
          });
        }
        if (assistantContent.length > 0) {
          messages.push({ role: "assistant", content: assistantContent });
        }

        if (turn.toolCalls.length === 0) {
          return finish("completed", { finalText: turn.text });
        }

        const results: ContentBlock[] = [];
        for (const call of turn.toolCalls) {
          if (signal?.aborted) return finish("aborted");

          onEvent({
            type: "tool_started",
            runId,
            iteration,
            toolCallId: call.id,
            name: call.name,
            input: call.input,
            at: Date.now(),
          });

          const toolStart = Date.now();
          let output: string;
          let isError = false;
          const tool = toolsByName.get(call.name);
          if (!tool) {
            output = `Unknown tool: ${call.name}`;
            isError = true;
          } else {
            try {
              const result = await tool.execute(call.input);
              output = result.output;
              isError = result.isError ?? false;
            } catch (error) {
              output = `Tool threw: ${error instanceof Error ? error.message : String(error)}`;
              isError = true;
            }
          }

          onEvent({
            type: "tool_finished",
            runId,
            iteration,
            toolCallId: call.id,
            name: call.name,
            output,
            isError,
            durationMs: Date.now() - toolStart,
            at: Date.now(),
          });

          results.push({
            type: "tool_result",
            toolUseId: call.id,
            content: output,
            isError,
          });
        }
        messages.push({ role: "user", content: results });
      }

      return finish("max_iterations");
    } catch (error) {
      return finish("failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
