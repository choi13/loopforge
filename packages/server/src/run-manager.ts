import { randomUUID } from "node:crypto";
import {
  AgentLoop,
  AnthropicProvider,
  MockProvider,
  type ModelProvider,
  type RunStatus,
  type TokenUsage,
  type TraceEvent,
} from "@loopforge/core";
import {
  createEnvironment,
  type EnvironmentName,
  type RunEnvironment,
} from "./environments/index";

/** The shape the dashboard renders in the run list. Mirrors the API contract. */
export interface RunSummary {
  id: string;
  task: string;
  provider: string;
  model: string;
  environment: EnvironmentName;
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
  environment: RunEnvironment;
}

/**
 * In-memory registry of runs. Each run owns an AbortController, an event log,
 * and a fresh environment instance; every trace event updates the summary and
 * is pushed to the broadcast callback so connected dashboards stay live.
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

  createRun(
    provider: "mock" | "anthropic",
    task: string,
    environment: EnvironmentName = "coding",
  ): RunSummary {
    const runId = randomUUID();

    // Environments push state snapshots through here; they flow through the
    // normal event path (appended to the log, broadcast as a trace message).
    const publishState = (state: unknown): void => {
      const record = this.runs.get(runId);
      if (!record) return;
      this.handleEvent(record, { type: "env_state", runId, state, at: Date.now() });
    };
    const env = createEnvironment(environment, publishState);

    let modelProvider: ModelProvider;
    let effectiveTask = task;
    if (provider === "mock") {
      env.prepare?.();
      modelProvider = new MockProvider(env.buildDemoScript?.() ?? []);
      effectiveTask = env.demoTask;
    } else {
      modelProvider = new AnthropicProvider();
      // Sokoban runs may omit the task; fall back to the environment's demo task.
      if (!effectiveTask) effectiveTask = env.demoTask;
    }

    const controller = new AbortController();
    const summary: RunSummary = {
      id: runId,
      task: effectiveTask,
      provider: modelProvider.name,
      model: modelProvider.model,
      environment,
      status: "running",
      createdAt: Date.now(),
      iterations: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const record: RunRecord = { summary, events: [], controller, environment: env };
    this.runs.set(runId, record);

    const loop = new AgentLoop({
      provider: modelProvider,
      tools: env.tools,
      systemPrompt: env.systemPrompt,
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

    // Right after run_started lands, let the environment publish its initial
    // state (the opening board) so it sits before the first model turn.
    if (event.type === "run_started") {
      record.environment.onRunStart?.();
    }
  }
}
