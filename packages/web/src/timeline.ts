import type { TokenUsage, TraceEvent } from "./types";

export interface ToolVM {
  id: string;
  name: string;
  input: unknown;
  hasInput: boolean;
  /** tool_finished has arrived */
  done: boolean;
  output?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface IterationVM {
  n: number;
  messageCount?: number;
  usage?: TokenUsage;
  thinking?: string;
  text?: string;
  tools: ToolVM[];
}

export type RunStartedEvent = Extract<TraceEvent, { type: "run_started" }>;
export type RunFinishedEvent = Extract<TraceEvent, { type: "run_finished" }>;

export interface TimelineVM {
  started?: RunStartedEvent;
  iterations: IterationVM[];
  finished?: RunFinishedEvent;
}

/**
 * Folds a flat, append-only event stream into the per-iteration view model the
 * timeline renders. Safe to call on every render (memoize upstream); tolerant
 * of partially-delivered runs (e.g. tool_started with no tool_finished yet).
 */
export function buildTimeline(events: TraceEvent[]): TimelineVM {
  const vm: TimelineVM = { iterations: [] };
  const byIteration = new Map<number, IterationVM>();
  const toolsById = new Map<string, ToolVM>();

  const iteration = (n: number): IterationVM => {
    let it = byIteration.get(n);
    if (!it) {
      it = { n, tools: [] };
      byIteration.set(n, it);
      vm.iterations.push(it);
    }
    return it;
  };

  for (const e of events) {
    switch (e.type) {
      case "run_started":
        vm.started = e;
        break;

      case "iteration_started":
        iteration(e.iteration);
        break;

      case "model_request":
        iteration(e.iteration).messageCount = e.messageCount;
        break;

      case "model_response": {
        const it = iteration(e.iteration);
        it.usage = e.usage;
        it.thinking = e.thinking;
        it.text = e.text;
        for (const call of e.toolCalls) {
          if (!toolsById.has(call.id)) {
            const tool: ToolVM = {
              id: call.id,
              name: call.name,
              input: call.input,
              hasInput: true,
              done: false,
            };
            toolsById.set(call.id, tool);
            it.tools.push(tool);
          }
        }
        break;
      }

      case "tool_started": {
        const it = iteration(e.iteration);
        const existing = toolsById.get(e.toolCallId);
        if (existing) {
          existing.input = e.input;
          existing.hasInput = true;
        } else {
          const tool: ToolVM = {
            id: e.toolCallId,
            name: e.name,
            input: e.input,
            hasInput: true,
            done: false,
          };
          toolsById.set(e.toolCallId, tool);
          it.tools.push(tool);
        }
        break;
      }

      case "tool_finished": {
        const it = iteration(e.iteration);
        let tool = toolsById.get(e.toolCallId);
        if (!tool) {
          tool = {
            id: e.toolCallId,
            name: e.name,
            input: undefined,
            hasInput: false,
            done: false,
          };
          toolsById.set(e.toolCallId, tool);
          it.tools.push(tool);
        }
        tool.done = true;
        tool.output = e.output;
        tool.isError = e.isError;
        tool.durationMs = e.durationMs;
        break;
      }

      case "run_finished":
        vm.finished = e;
        break;

      default:
        // env_state (owned by the environment board panel) and any future
        // event types are intentionally not part of iteration cards.
        break;
    }
  }

  vm.iterations.sort((a, b) => a.n - b.n);
  return vm;
}
