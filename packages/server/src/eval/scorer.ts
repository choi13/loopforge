import type { TraceEvent } from "@loopforge/core";
import type { EnvironmentName } from "../environments/index";

/**
 * Deterministic, event-based scoring. A run is judged purely from its recorded
 * TraceEvent[] after it finishes — no sandbox inspection, no model in the loop.
 * This is what lets an eval prove the harness can tell success from failure.
 */

export interface RunScore {
  /** Whether the run met the environment's success condition. */
  passed: boolean;
  /** Short human-readable explanation of the verdict. */
  reason: string;
}

/** The terminal event of a run — carries the final status the scorer needs. */
export type RunFinishedEvent = Extract<TraceEvent, { type: "run_finished" }>;

/**
 * Score a finished run.
 *
 * - A run that ended "failed" or "aborted" is always a fail (it never got the
 *   chance to succeed), regardless of environment.
 * - coding: PASS iff some run_command tool call completed without error AND its
 *   output contains "All tests passed". We scope to run_command tool outputs so
 *   a `read_file` that merely echoes the `console.log("All tests passed")`
 *   source line in test.js can never masquerade as a passing test run.
 * - sokoban: PASS iff some published env_state reports solved === true.
 */
export function scoreRun(
  environment: EnvironmentName,
  events: TraceEvent[],
  runFinished: RunFinishedEvent,
): RunScore {
  if (runFinished.status === "failed" || runFinished.status === "aborted") {
    return { passed: false, reason: `run ${runFinished.status}` };
  }

  if (environment === "coding") {
    return scoreCoding(events);
  }
  return scoreSokoban(events);
}

function scoreCoding(events: TraceEvent[]): RunScore {
  for (const event of events) {
    if (
      event.type === "tool_finished" &&
      event.name === "run_command" &&
      !event.isError &&
      event.output.includes("All tests passed")
    ) {
      return { passed: true, reason: "tests passed" };
    }
  }
  return { passed: false, reason: "tests never passed" };
}

function scoreSokoban(events: TraceEvent[]): RunScore {
  for (const event of events) {
    if (event.type !== "env_state") continue;
    const state = event.state;
    if (typeof state !== "object" || state === null) continue;
    const { solved, moveCount } = state as { solved?: unknown; moveCount?: unknown };
    if (solved === true) {
      const moves = typeof moveCount === "number" ? moveCount : 0;
      return { passed: true, reason: `puzzle solved in ${moves} moves` };
    }
  }
  return { passed: false, reason: "puzzle not solved" };
}
