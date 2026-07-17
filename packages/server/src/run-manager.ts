import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentLoop,
  AnthropicProvider,
  MockProvider,
  createCodingTools,
  type ModelProvider,
  type RunStatus,
  type TokenUsage,
  type TraceEvent,
} from "@loopforge/core";
import { DEMO_TASK, buildDemoScript, resetDemoSandbox } from "./demo";

/** The shape the dashboard renders in the run list. Mirrors the API contract. */
export interface RunSummary {
  id: string;
  task: string;
  provider: string;
  model: string;
  status: RunStatus;
  createdAt: number;
  iterations: number;
  usage: TokenUsage;
}

/** Messages pushed over the WebSocket. Mirrors the API contract. */
export type ServerMessage =
  | { type: "run_created"; run: RunSummary }
  | { type: "trace"; runId: string; event: TraceEvent }
  | { type: "run_updated"; run: RunSummary };

interface RunRecord {
  summary: RunSummary;
  events: TraceEvent[];
  controller: AbortController;
}

// src is at packages/server/src — three levels up is the repo root.
const SANDBOX_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "sandbox",
  "demo-project",
);

const SYSTEM_PROMPT =
  "You are a coding agent working in a small sandboxed JavaScript project. Use the tools to explore the project, run code, and edit files. Always verify your changes by running the tests before declaring success. When the task is complete, reply with a brief summary and stop calling tools.";

/**
 * In-memory registry of runs. Each run owns an AbortController and an event
 * log; every trace event updates the summary and is pushed to the broadcast
 * callback so connected dashboards stay live.
 */
export class RunManager {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly broadcast: (message: ServerMessage) => void) {}

  listRuns(): RunSummary[] {
    return [...this.runs.values()]
      .map((record) => record.summary)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getRun(id: string): { summary: RunSummary; events: TraceEvent[] } | undefined {
    const record = this.runs.get(id);
    if (!record) return undefined;
    return { summary: record.summary, events: record.events };
  }

  createRun(provider: "mock" | "anthropic", task: string): RunSummary {
    const runId = randomUUID();
    const tools = createCodingTools(SANDBOX_DIR);

    let modelProvider: ModelProvider;
    let effectiveTask = task;
    if (provider === "mock") {
      resetDemoSandbox(SANDBOX_DIR);
      modelProvider = new MockProvider(buildDemoScript());
      effectiveTask = DEMO_TASK;
    } else {
      modelProvider = new AnthropicProvider();
    }

    const controller = new AbortController();
    const summary: RunSummary = {
      id: runId,
      task: effectiveTask,
      provider: modelProvider.name,
      model: modelProvider.model,
      status: "running",
      createdAt: Date.now(),
      iterations: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const record: RunRecord = { summary, events: [], controller };
    this.runs.set(runId, record);

    const loop = new AgentLoop({
      provider: modelProvider,
      tools,
      systemPrompt: SYSTEM_PROMPT,
      maxIterations: 20,
      onEvent: (event) => this.handleEvent(record, event),
    });

    this.broadcast({ type: "run_created", run: summary });

    // Fire and forget: the HTTP handler returns immediately while the loop
    // streams events. The loop reports its own failures via run_finished; this
    // catch covers anything thrown outside that path so nothing is unhandled.
    loop.run(runId, effectiveTask, controller.signal).catch((error: unknown) => {
      summary.status = "failed";
      this.broadcast({ type: "run_updated", run: summary });
      console.error(`run ${runId} crashed:`, error);
    });

    return summary;
  }

  abort(id: string): boolean {
    const record = this.runs.get(id);
    if (!record) return false;
    record.controller.abort();
    return true;
  }

  private handleEvent(record: RunRecord, event: TraceEvent): void {
    record.events.push(event);
    const { summary } = record;

    let summaryChanged = false;
    if (event.type === "iteration_started") {
      summary.iterations = event.iteration;
      summaryChanged = true;
    } else if (event.type === "model_response") {
      // Accumulate live so summaries show token totals mid-run.
      summary.usage.inputTokens += event.usage.inputTokens;
      summary.usage.outputTokens += event.usage.outputTokens;
    } else if (event.type === "run_finished") {
      summary.status = event.status;
      summary.iterations = event.iterations;
      summary.usage = { ...event.totalUsage };
      summaryChanged = true;
    }

    this.broadcast({ type: "trace", runId: summary.id, event });
    if (summaryChanged) {
      this.broadcast({ type: "run_updated", run: summary });
    }
  }
}
