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

const ERROR_PAGE_SUMMARY =
  "URL: http://localhost:8788/order\nTitle: LoopMart — Error\nHeadings: Internal Server Error (500)\nPage text:\nOrder processing failed: ERR_ORDER_FAILED";

test("browser: PASS when a successful click output contains the planted 500", () => {
  const events: TraceEvent[] = [
    toolFinished("b1", "click", ERROR_PAGE_SUMMARY),
  ];
  const score = scoreRun("browser", events, finished("completed"));
  assert.equal(score.passed, true);
  assert.equal(score.reason, "found the checkout bug");
});

test("browser: FAIL when no click ever surfaces the 500", () => {
  const events: TraceEvent[] = [
    toolFinished("b1", "goto", "URL: http://localhost:8788/\nTitle: LoopMart"),
    toolFinished("b2", "click", "URL: http://localhost:8788/products\nTitle: LoopMart — Products"),
    toolFinished("b3", "read_page", "URL: http://localhost:8788/products"),
  ];
  const score = scoreRun("browser", events, finished("completed"));
  assert.equal(score.passed, false);
  assert.equal(score.reason, "checkout bug never surfaced");
});

test("browser: an errored click showing the 500 text does NOT pass", () => {
  const events: TraceEvent[] = [
    toolFinished("b1", "click", ERROR_PAGE_SUMMARY, true),
  ];
  assert.equal(scoreRun("browser", events, finished("completed")).passed, false);
});

test("browser: a non-click tool showing the 500 text does NOT pass", () => {
  // Only clicking through the broken order flow counts, not reading about it.
  const events: TraceEvent[] = [
    toolFinished("b1", "read_page", ERROR_PAGE_SUMMARY),
  ];
  assert.equal(scoreRun("browser", events, finished("completed")).passed, false);
});

test("browser: a failed run is always a fail", () => {
  const events: TraceEvent[] = [
    toolFinished("b1", "click", ERROR_PAGE_SUMMARY),
  ];
  assert.equal(scoreRun("browser", events, finished("failed")).passed, false);
});
