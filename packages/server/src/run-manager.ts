import { randomUUID } from "node:crypto";
import {
  AgentLoop,
  AnthropicProvider,
  ClaudeCliProvider,
  MockProvider,
  OllamaProvider,
  type ModelProvider,
  type RunStatus,
  type TokenUsage,
  type TraceEvent,
} from "@loopforge/core";

/** Providers a run can be driven by. */
export type ProviderName = "mock" | "anthropic" | "ollama" | "claude-cli";
import {
  createEnvironment,
  type EnvironmentName,
  type RunEnvironment,
} from "./environments/index";
import { buildMockScript, type ScriptKey } from "./mock-scripts";

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

/** The terminal event of a run, handed to onFinished callers. */
type RunFinishedEvent = Extract<TraceEvent, { type: "run_finished" }>;

/** Payload delivered once, when a run reaches a terminal state. */
export interface RunFinishedNotice {
  runId: string;
  summary: RunSummary;
  events: TraceEvent[];
  runFinished: RunFinishedEvent;
}

/**
 * Options for an eval-driven run. Manual runs pass none of these and behave
 * exactly as before: a fresh runId, the environment's default demo script (for
 * mock), and no finish callback.
 */
export interface CreateRunOptions {
  /** Use this exact runId instead of a fresh one (lets the eval pre-assign it). */
  runId?: string;
  /** For mock runs: play this specific script instead of the env default. */
  mockScriptKey?: ScriptKey;
  /** Invoked once when the run finishes, with its recorded events. */
  onFinished?: (notice: RunFinishedNotice) => void;
}

interface RunRecord {
  summary: RunSummary;
  events: TraceEvent[];
  controller: AbortController;
  environment: RunEnvironment;
  onFinished?: (notice: RunFinishedNotice) => void;
  /** Guards onFinished so it fires exactly once. */
  notified: boolean;
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
    provider: ProviderName,
    task: string,
    environment: EnvironmentName = "coding",
    options: CreateRunOptions = {},
  ): RunSummary {
    const runId = options.runId ?? randomUUID();

    // Environments push state snapshots through here; they flow through the
    // normal event path (appended to the log, broadcast as a trace message).
    // A monotonic seq gives each snapshot a stable identity so the client never
    // conflates two emitted within the same millisecond.
    let envSeq = 0;
    const publishState = (state: unknown): void => {
      const record = this.runs.get(runId);
      if (!record) return;
      this.handleEvent(record, {
        type: "env_state",
        runId,
        seq: envSeq++,
        state,
        at: Date.now(),
      });
    };
    const env = createEnvironment(environment, publishState, runId);

    let modelProvider: ModelProvider;
    let effectiveTask = task;
    if (provider === "mock") {
      env.prepare?.();
      // An eval can pin a specific script (e.g. the lazy coding run that must
      // FAIL); a manual mock run falls back to the environment's demo script.
      const steps = options.mockScriptKey
        ? buildMockScript(options.mockScriptKey)
        : env.buildDemoScript?.() ?? [];
      modelProvider = new MockProvider(steps);
      effectiveTask = env.demoTask;
    } else {
      // Real model providers. Ollama runs a local model (no API key / cost);
      // claude-cli drives the local Claude Code CLI on its logged-in account
      // (no API key); Anthropic calls the Claude API directly.
      modelProvider =
        provider === "ollama"
          ? new OllamaProvider()
          : provider === "claude-cli"
            ? new ClaudeCliProvider()
            : new AnthropicProvider();
      // Runs may omit the task (e.g. sokoban); fall back to the demo task.
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
    const record: RunRecord = {
      summary,
      events: [],
      controller,
      environment: env,
      onFinished: options.onFinished,
      notified: false,
    };
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
      // The loop normally emits run_finished (which triggers cleanup); this
      // path covers a throw outside that flow so the temp sandbox still goes
      // and any eval waiting on this run is still notified (once).
      this.cleanup(record);
      this.notifyFinished(record, {
        type: "run_finished",
        runId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        iterations: summary.iterations,
        totalUsage: summary.usage,
        durationMs: Date.now() - summary.createdAt,
        at: Date.now(),
      });
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

    // When the run ends, tear down any per-run resources (e.g. the coding
    // environment's temp sandbox) and notify any eval waiting on this run.
    // Best-effort — cleanup must never throw.
    if (event.type === "run_finished") {
      this.cleanup(record);
      this.notifyFinished(record, event);
    }
  }

  /** Run an environment's best-effort teardown, swallowing any failure. */
  private cleanup(record: RunRecord): void {
    try {
      record.environment.cleanup?.();
    } catch (error) {
      console.error(`cleanup for run ${record.summary.id} failed:`, error);
    }
  }

  /**
   * Deliver the terminal notice to an onFinished caller exactly once, whether
   * the run ended via run_finished or a throw outside it. No-op for manual runs
   * (which register no callback).
   */
  private notifyFinished(record: RunRecord, runFinished: RunFinishedEvent): void {
    if (record.notified) return;
    record.notified = true;
    record.onFinished?.({
      runId: record.summary.id,
      summary: record.summary,
      events: record.events,
      runFinished,
    });
  }
}
