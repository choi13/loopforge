import assert from "node:assert/strict";
import { test } from "node:test";
import type { TraceEvent } from "@loopforge/core";
import { scoreRun, type RunFinishedEvent } from "./scorer";

const R = "run-1";

function toolStarted(toolCallId: string, name: string, input: unknown): TraceEvent {
  return { type: "tool_started", runId: R, iteration: 1, toolCallId, name, input, at: 0 };
}
function toolFinished(
  toolCallId: string,
  name: string,
  output: string,
  isError = false,
): TraceEvent {
  return {
    type: "tool_finished",
    runId: R,
    iteration: 1,
    toolCallId,
    name,
    output,
    isError,
    durationMs: 1,
    at: 0,
  };
}
function envState(state: unknown, seq = 0): TraceEvent {
  return { type: "env_state", runId: R, seq, state, at: 0 };
}
function finished(status: RunFinishedEvent["status"]): RunFinishedEvent {
  return {
    type: "run_finished",
    runId: R,
    status,
    iterations: 3,
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    durationMs: 1,
    at: 0,
  };
}

test("coding: PASS when `node test.js` runs and prints All tests passed", () => {
  const events: TraceEvent[] = [
    toolStarted("t1", "run_command", { command: "node test.js" }),
    toolFinished("t1", "run_command", "All tests passed\n[exit code: 0]"),
  ];
  assert.equal(scoreRun("coding", events, finished("completed")).passed, true);
});

test("REGRESSION: `cat test.js` echoing the source string does NOT pass", () => {
  // The phrase lives in test.js's source; a mere read must not count as a run.
  const catOutput = 'console.log("All tests passed");\n[exit code: 0]';
  const events: TraceEvent[] = [
    toolStarted("t1", "run_command", { command: "cat test.js" }),
    toolFinished("t1", "run_command", catOutput),
  ];
  assert.equal(scoreRun("coding", events, finished("completed")).passed, false);
});

test("coding: FAIL when tests were never run", () => {
  const events: TraceEvent[] = [
    toolStarted("t1", "read_file", { path: "calc.js" }),
    toolFinished("t1", "read_file", "function add(){}"),
  ];
  assert.equal(scoreRun("coding", events, finished("completed")).passed, false);
});

test("coding: a failed run is always a fail", () => {
  const events: TraceEvent[] = [
    toolStarted("t1", "run_command", { command: "node test.js" }),
    toolFinished("t1", "run_command", "All tests passed\n[exit code: 0]"),
  ];
  assert.equal(scoreRun("coding", events, finished("failed")).passed, false);
});

test("sokoban: PASS when some snapshot reports solved", () => {
  const events: TraceEvent[] = [
    envState({ solved: false, moveCount: 0 }, 0),
    envState({ solved: true, moveCount: 15 }, 1),
  ];
  const score = scoreRun("sokoban", events, finished("completed"));
  assert.equal(score.passed, true);
  assert.match(score.reason, /15/);
});

test("sokoban: FAIL when never solved", () => {
  const events: TraceEvent[] = [envState({ solved: false, moveCount: 3 }, 0)];
  assert.equal(scoreRun("sokoban", events, finished("completed")).passed, false);
});
