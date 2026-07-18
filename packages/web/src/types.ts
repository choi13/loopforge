/**
 * Shared client-side types.
 *
 * Core trace types are imported TYPE-ONLY from the core package (safe: type
 * imports are erased at build time, so no Node-only code reaches the browser).
 * RunSummary and the WebSocket message union mirror the server API contract.
 */
import type { TraceEvent, TokenUsage, RunStatus } from "../../core/src/events";

export type { TraceEvent, TokenUsage, RunStatus, ToolCallRef } from "../../core/src/events";

export type Provider = "mock" | "anthropic" | "ollama" | "claude-cli";

export type Environment = "coding" | "sokoban";

/** Top-level dashboard view. */
export type View = "runs" | "evals";

export interface RunSummary {
  id: string;
  task: string;
  provider: string;
  environment: Environment;
  model: string;
  status: RunStatus;
  createdAt: number;
  iterations: number;
  usage: TokenUsage;
}

/**
 * Payload of `env_state` events for coding runs: the cumulative latest
 * file-diff snapshot. One entry per file ever written in the run; `before` is
 * the content prior to the FIRST write of the run (null when the file did not
 * exist) and `after` is the most recently written content.
 */
export interface CodingFileChange {
  path: string;
  before: string | null;
  after: string;
}

export interface CodingFilesState {
  kind: "coding_files";
  changes: CodingFileChange[];
}

/**
 * Payload of `env_state` events for sokoban runs. Coordinates are
 * [x, y] pairs — x = column from the left, y = row from the top, 0-based.
 */
export interface SokobanState {
  width: number;
  height: number;
  walls: [number, number][];
  goals: [number, number][];
  boxes: [number, number][];
  player: [number, number];
  moveCount: number;
  solved: boolean;
}

/* ---------- evals (Phase 3) ----------
   An EVAL is a batch of runs over a task suite, each scored pass/fail then
   aggregated. The runs an eval spawns are REAL runs (fetchable by runId), so a
   result row can drill into the same trace/board UI a manual run uses. */

/** One task in a suite. */
export interface SuiteTask {
  id: string;
  environment: Environment;
  task: string;
}

/** A named collection of tasks the harness can batch-run. */
export interface Suite {
  id: string;
  name: string;
  tasks: SuiteTask[];
}

/** Deterministic pass/fail verdict for a scored run. */
export interface RunScore {
  passed: boolean;
  /** Short human-readable explanation, e.g. "tests passed" / "puzzle not solved". */
  reason: string;
}

/** Lifecycle of a single run within an eval batch. */
export type EvalRunStatus = "pending" | "running" | "scored";

/** One run inside an eval — its live status, then its score. */
export interface EvalRunResult {
  runId: string;
  taskId: string;
  environment: Environment;
  provider: string;
  status: EvalRunStatus;
  runStatus: RunStatus | null;
  /** null until the run finishes and is scored. */
  score: RunScore | null;
  iterations: number;
  usage: TokenUsage;
  durationMs: number | null;
}

/** Aggregate stats over the SCORED runs of an eval (zeros when none scored). */
export interface EvalAggregate {
  passRate: number;
  meanIterations: number;
  meanTokensIn: number;
  meanTokensOut: number;
  meanDurationMs: number;
}

/** A batch of scored runs over a suite, plus rolled-up progress and stats. */
export interface EvalSummary {
  id: string;
  suiteId: string;
  suiteName: string;
  provider: Provider;
  /** Per-provider model override, or null when the provider default was used. */
  model: string | null;
  repeats: number;
  status: "running" | "completed";
  createdAt: number;
  total: number;
  done: number;
  passed: number;
  failed: number;
  /** May be empty in the list form; always present on the detail endpoint / WS. */
  results: EvalRunResult[];
  aggregate: EvalAggregate;
}

/** Messages pushed by the server over ws://…/ws */
export type ServerMessage =
  | { type: "run_created"; run: RunSummary }
  | { type: "trace"; runId: string; event: TraceEvent }
  | { type: "run_updated"; run: RunSummary }
  | { type: "eval_created"; eval: EvalSummary }
  | { type: "eval_updated"; eval: EvalSummary };
