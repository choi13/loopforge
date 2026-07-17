import { randomUUID } from "node:crypto";
import type { EnvironmentName } from "./environments/index";
import type { RunManager } from "./run-manager";
import { scoreRun, type RunScore } from "./eval/scorer";
import {
  getSuite,
  type Suite,
  type SuiteTaskInternal,
} from "./eval/suites";

/**
 * The eval harness: run a whole task suite, score every run pass/fail, and
 * aggregate. Runs are REAL runs executed through RunManager (so each appears in
 * /api/runs and streams its own trace), driven with a task-specific mock script
 * so the demo suite lands its designed 2-pass / 2-fail split.
 */

/** One scored run inside an eval. Mirrors the API contract exactly. */
export interface EvalRunResult {
  runId: string;
  taskId: string;
  environment: EnvironmentName;
  provider: string;
  status: "pending" | "running" | "scored";
  runStatus: "running" | "completed" | "failed" | "aborted" | "max_iterations" | null;
  score: RunScore | null;
  iterations: number;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number | null;
}

/** Aggregate metrics over the SCORED runs of an eval (zeros when none scored). */
export interface EvalAggregate {
  passRate: number;
  meanIterations: number;
  meanTokensIn: number;
  meanTokensOut: number;
  meanDurationMs: number;
}

/** The full eval record, mirrored to clients over REST and WebSocket. */
export interface EvalSummary {
  id: string;
  suiteId: string;
  suiteName: string;
  provider: "mock" | "anthropic";
  repeats: number;
  status: "running" | "completed";
  createdAt: number;
  total: number;
  done: number;
  passed: number;
  failed: number;
  results: EvalRunResult[];
  aggregate: EvalAggregate;
}

/** Additive WebSocket messages for eval lifecycle. */
export type EvalMessage =
  | { type: "eval_created"; eval: EvalSummary }
  | { type: "eval_updated"; eval: EvalSummary };

export interface CreateEvalParams {
  suiteId: string;
  provider: "mock" | "anthropic";
  repeats: number;
}

/** Max runs executing at once across an eval batch. */
const CONCURRENCY = 3;

/** A planned run: its result slot plus the internal task it came from. */
interface EvalPlan {
  result: EvalRunResult;
  task: SuiteTaskInternal;
}

interface EvalRecord {
  summary: EvalSummary;
  plans: EvalPlan[];
}

function emptyAggregate(): EvalAggregate {
  return {
    passRate: 0,
    meanIterations: 0,
    meanTokensIn: 0,
    meanTokensOut: 0,
    meanDurationMs: 0,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class EvalManager {
  private readonly evals = new Map<string, EvalRecord>();

  constructor(
    private readonly runManager: RunManager,
    private readonly broadcast: (message: EvalMessage) => void,
  ) {}

  /** Newest first; results are omitted (light list form) to keep it cheap. */
  list(): EvalSummary[] {
    return [...this.evals.values()]
      .map((record) => ({ ...record.summary, results: [] }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Full detail, including per-run results. */
  get(id: string): EvalSummary | undefined {
    return this.evals.get(id)?.summary;
  }

  /**
   * Build the run list (suite tasks x repeats), return the EvalSummary
   * immediately with everything pending, then execute the batch asynchronously
   * with a concurrency cap. The caller has already validated inputs.
   */
  create(params: CreateEvalParams): EvalSummary {
    const suite = getSuite(params.suiteId);
    if (!suite) {
      // Guarded at the route; this keeps the type honest for direct callers.
      throw new Error(`Unknown suite: ${params.suiteId}`);
    }

    const plans = this.buildPlans(suite, params);
    const summary: EvalSummary = {
      id: randomUUID(),
      suiteId: suite.id,
      suiteName: suite.name,
      provider: params.provider,
      repeats: params.repeats,
      status: "running",
      createdAt: Date.now(),
      total: plans.length,
      done: 0,
      passed: 0,
      failed: 0,
      results: plans.map((plan) => plan.result),
      aggregate: emptyAggregate(),
    };
    const record: EvalRecord = { summary, plans };
    this.evals.set(summary.id, record);

    this.broadcast({ type: "eval_created", eval: summary });
    void this.execute(record).catch((error: unknown) => {
      console.error(`eval ${summary.id} crashed:`, error);
    });

    return summary;
  }

  private buildPlans(suite: Suite, params: CreateEvalParams): EvalPlan[] {
    const plans: EvalPlan[] = [];
    for (let repeat = 0; repeat < params.repeats; repeat += 1) {
      for (const task of suite.tasks) {
        const result: EvalRunResult = {
          runId: randomUUID(),
          taskId: task.id,
          environment: task.environment,
          provider: params.provider,
          status: "pending",
          runStatus: null,
          score: null,
          iterations: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: null,
        };
        plans.push({ result, task });
      }
    }
    return plans;
  }

  /** Drain the plan queue through a fixed pool of workers, then finalize. */
  private async execute(record: EvalRecord): Promise<void> {
    const queue = [...record.plans];
    const worker = async (): Promise<void> => {
      for (;;) {
        const plan = queue.shift();
        if (!plan) return;
        await this.runOne(record, plan);
      }
    };
    const workerCount = Math.min(CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    record.summary.status = "completed";
    this.broadcast({ type: "eval_updated", eval: record.summary });
  }

  /** Start one real run, score it when it finishes, and fold it into the eval. */
  private runOne(record: EvalRecord, plan: EvalPlan): Promise<void> {
    const { result, task } = plan;
    result.status = "running";
    result.runStatus = "running";
    this.recompute(record);
    this.broadcast({ type: "eval_updated", eval: record.summary });

    return new Promise<void>((resolve) => {
      this.runManager.createRun(record.summary.provider, task.task, task.environment, {
        runId: result.runId,
        // Only the mock provider replays scripts; anthropic uses the real model.
        mockScriptKey:
          record.summary.provider === "mock" ? task.mockScriptKey : undefined,
        onFinished: ({ events, runFinished }) => {
          result.status = "scored";
          result.runStatus = runFinished.status;
          result.iterations = runFinished.iterations;
          result.usage = { ...runFinished.totalUsage };
          result.durationMs = runFinished.durationMs;
          result.score = scoreRun(task.environment, events, runFinished);
          this.recompute(record);
          this.broadcast({ type: "eval_updated", eval: record.summary });
          resolve();
        },
      });
    });
  }

  /** Recompute counts + aggregate from the current result states. */
  private recompute(record: EvalRecord): void {
    const scored = record.summary.results.filter((r) => r.status === "scored");
    const passed = scored.filter((r) => r.score?.passed === true);
    record.summary.done = scored.length;
    record.summary.passed = passed.length;
    record.summary.failed = scored.length - passed.length;
    record.summary.aggregate =
      scored.length === 0
        ? emptyAggregate()
        : {
            passRate: passed.length / scored.length,
            meanIterations: mean(scored.map((r) => r.iterations)),
            meanTokensIn: mean(scored.map((r) => r.usage.inputTokens)),
            meanTokensOut: mean(scored.map((r) => r.usage.outputTokens)),
            meanDurationMs: mean(scored.map((r) => r.durationMs ?? 0)),
          };
  }
}
