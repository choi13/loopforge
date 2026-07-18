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
 * - coding: PASS iff some run_command that actually EXECUTES the tests (e.g.
 *   `node test.js`) completed without error AND printed "All tests passed".
 *   Correlating with the command matters: the phrase also appears in test.js's
 *   source, so a `cat test.js` (whose output includes the console.log line and
 *   an exit code 0) must not masquerade as a passing test run.
 * - sokoban: PASS iff some published env_state reports solved === true.
 * - browser: PASS iff some successful click observed the planted 500 — the
 *   agent must actually exercise the broken order flow, not just browse.
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
  if (environment === "browser") {
    return scoreBrowser(events);
  }
  return scoreSokoban(events);
}

/** True when a shell command actually runs the test suite (not a cat/echo). */
function isTestExecution(command: string): boolean {
  const c = command.toLowerCase();
  return (
    (/\bnode\b/.test(c) && /test/.test(c)) ||
    /\bnpm\b[^\n]*\btest\b/.test(c) ||
    /\bnpx\b[^\n]*\btest\b/.test(c)
  );
}

function scoreCoding(events: TraceEvent[]): RunScore {
  // Map each run_command invocation to the command string it ran.
  const commandById = new Map<string, string>();
  for (const event of events) {
    if (event.type === "tool_started" && event.name === "run_command") {
      const command =
        typeof (event.input as { command?: unknown })?.command === "string"
          ? (event.input as { command: string }).command
          : "";
      commandById.set(event.toolCallId, command);
    }
  }

  for (const event of events) {
    if (
      event.type === "tool_finished" &&
      event.name === "run_command" &&
      !event.isError &&
      event.output.includes("All tests passed") &&
      isTestExecution(commandById.get(event.toolCallId) ?? "")
    ) {
      return { passed: true, reason: "tests passed" };
    }
  }
  return { passed: false, reason: "tests never passed" };
}

/**
 * PASS iff a SUCCESSFUL click's output contains the planted checkout error —
 * i.e. the agent clicked through to the broken order submission and saw the
 * 500 page. Reading about the error elsewhere (or an errored click) does not
 * count: the bug must surface through the real flow.
 */
function scoreBrowser(events: TraceEvent[]): RunScore {
  for (const event of events) {
    if (
      event.type === "tool_finished" &&
      event.name === "click" &&
      !event.isError &&
      event.output.includes("Internal Server Error (500)")
    ) {
      return { passed: true, reason: "found the checkout bug" };
    }
  }
  return { passed: false, reason: "checkout bug never surfaced" };
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
