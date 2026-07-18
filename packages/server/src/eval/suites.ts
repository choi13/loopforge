import { DEMO_TASK } from "../demo";
import { BROWSER_DEMO_TASK } from "../environments/browser";
import type { EnvironmentName } from "../environments/index";
import { SOKOBAN_DEMO_TASK } from "../environments/sokoban";
import type { ScriptKey } from "../mock-scripts";

/**
 * Eval suites: named batches of tasks the harness runs and scores. The demo
 * suite is deliberately built as a 2-pass / 2-fail set under the mock provider
 * so the aggregate proves the scorer distinguishes a real fix from a lazy one.
 */

/** The task shape sent to clients — no server-internal fields. */
export interface SuiteTask {
  id: string;
  environment: EnvironmentName;
  task: string;
}

/**
 * Internal task: the public shape plus the mock script key the eval layer hands
 * to the MockProvider so a given task runs its intended scripted behavior
 * (solve vs. lazy vs. stuck). Never leaves the server.
 */
export interface SuiteTaskInternal extends SuiteTask {
  mockScriptKey: ScriptKey;
}

export interface Suite {
  id: string;
  name: string;
  tasks: SuiteTaskInternal[];
}

/**
 * The "demo" suite: two coding tasks over the same broken calculator project
 * (one solved, one done lazily and left broken) and two sokoban tasks over the
 * same level (one solved, one abandoned unsolved). Under the mock provider this
 * yields exactly 2 passes and 2 fails.
 */
const DEMO_SUITE: Suite = {
  id: "demo",
  name: "Mixed demo suite",
  tasks: [
    // t1 coding-pass: the mock genuinely fixes the subtraction bug -> PASS.
    { id: "t1", environment: "coding", task: DEMO_TASK, mockScriptKey: "coding-solve" },
    // t2 coding-fail: the mock reads, runs the failing test, writes a still-wrong
    // fix and stops without a passing test run -> FAIL (tests never passed).
    { id: "t2", environment: "coding", task: DEMO_TASK, mockScriptKey: "coding-lazy" },
    // t3 sokoban-pass: the mock solves the level in 15 moves -> PASS.
    { id: "t3", environment: "sokoban", task: SOKOBAN_DEMO_TASK, mockScriptKey: "sokoban-solve" },
    // t4 sokoban-fail: the mock makes a few legal-but-wrong moves and gives up
    // without solving -> FAIL (puzzle not solved).
    { id: "t4", environment: "sokoban", task: SOKOBAN_DEMO_TASK, mockScriptKey: "sokoban-stuck" },
  ],
};

/**
 * The "web-qa" suite: two browser tasks over the LoopMart demo shop. Under the
 * mock provider this yields exactly 1 pass and 1 fail, proving the browser
 * scorer distinguishes a QA run that exercises the broken order flow from one
 * that merely browses.
 */
const WEB_QA_SUITE: Suite = {
  id: "web-qa",
  name: "Web QA suite",
  tasks: [
    // q1 browser-pass: the mock walks the full checkout flow, clicks Place
    // order, observes the planted 500, and reports the bug -> PASS.
    {
      id: "q1",
      environment: "browser",
      task: BROWSER_DEMO_TASK,
      mockScriptKey: "browser-find-bug",
    },
    // q2 browser-fail: the mock browses home and products but never submits
    // an order, so the 500 never surfaces -> FAIL.
    {
      id: "q2",
      environment: "browser",
      task: BROWSER_DEMO_TASK,
      mockScriptKey: "browser-miss-bug",
    },
  ],
};

const SUITES: Suite[] = [DEMO_SUITE, WEB_QA_SUITE];

export function listSuites(): Suite[] {
  return SUITES;
}

export function getSuite(id: string): Suite | undefined {
  return SUITES.find((suite) => suite.id === id);
}

/** Strip the internal mockScriptKey down to the public task shape for clients. */
export function toPublicTask(task: SuiteTaskInternal): SuiteTask {
  return { id: task.id, environment: task.environment, task: task.task };
}
