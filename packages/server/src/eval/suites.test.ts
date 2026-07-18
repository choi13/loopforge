import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_DEMO_TASK } from "../environments/browser";
import { buildMockScript } from "../mock-scripts";
import { getSuite, listSuites } from "./suites";

test("the web-qa suite has exactly 2 browser tasks with the demo task text", () => {
  const suite = getSuite("web-qa");
  assert.ok(suite, "web-qa suite should exist");
  assert.equal(suite.name, "Web QA suite");
  assert.equal(suite.tasks.length, 2);
  assert.deepEqual(
    suite.tasks.map((t) => t.id),
    ["q1", "q2"],
  );
  for (const task of suite.tasks) {
    assert.equal(task.environment, "browser");
    assert.equal(task.task, BROWSER_DEMO_TASK);
  }
  assert.equal(suite.tasks[0].mockScriptKey, "browser-find-bug");
  assert.equal(suite.tasks[1].mockScriptKey, "browser-miss-bug");
});

test("REGRESSION: the demo suite still has exactly 4 tasks", () => {
  const suite = getSuite("demo");
  assert.ok(suite);
  assert.equal(suite.tasks.length, 4);
});

test("both suites are listed", () => {
  assert.deepEqual(
    listSuites().map((s) => s.id),
    ["demo", "web-qa"],
  );
});

test("q1's script ends the flow by clicking Place order; q2's never does", () => {
  const clicksOf = (key: "browser-find-bug" | "browser-miss-bug") =>
    buildMockScript(key)
      .flatMap((step) => step.toolCalls ?? [])
      .filter((call) => call.name === "click")
      .map((call) => (call.input as { text: string }).text);

  assert.ok(clicksOf("browser-find-bug").includes("Place order"));
  assert.ok(!clicksOf("browser-miss-bug").includes("Place order"));
});
