import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MockStep } from "@loopforge/core";

/**
 * Everything needed for the no-API-key demo: the broken sandbox sources, the
 * fixed version, and a scripted mock run that genuinely finds and fixes the
 * bug — the tool calls below are executed for real by the agent loop.
 */

export const DEMO_TASK =
  "There is a failing test in this project. Find the bug, fix it, and make the tests pass.";

export const ORIGINAL_CALC = `function add(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, multiply };
`;

export const FIXED_CALC = `function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

module.exports = { add, multiply };
`;

export const TEST_SOURCE = `const assert = require("assert");
const { add, multiply } = require("./calc");

assert.strictEqual(add(2, 3), 5, "add(2, 3) should be 5");
assert.strictEqual(add(-1, 1), 0, "add(-1, 1) should be 0");
assert.strictEqual(multiply(3, 4), 12, "multiply(3, 4) should be 12");

console.log("All tests passed");
`;

/** Restore the sandbox to its broken state so every mock run starts fresh. */
export function resetDemoSandbox(sandboxDir: string): void {
  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(path.join(sandboxDir, "calc.js"), ORIGINAL_CALC, "utf8");
  writeFileSync(path.join(sandboxDir, "test.js"), TEST_SOURCE, "utf8");
}

/** The scripted debugging session the MockProvider plays back. */
export function buildDemoScript(): MockStep[] {
  return [
    {
      thinking:
        "Let me start by looking at the project structure to see what we are working with.",
      toolCalls: [{ name: "list_files", input: {} }],
      delayMs: 700,
    },
    {
      thinking:
        "Two files: calc.js and test.js. I will read the test first to understand the expected behavior.",
      toolCalls: [{ name: "read_file", input: { path: "test.js" } }],
      delayMs: 800,
    },
    {
      thinking:
        "The tests expect add(2, 3) === 5. Now let me look at the implementation.",
      toolCalls: [{ name: "read_file", input: { path: "calc.js" } }],
      delayMs: 650,
    },
    {
      thinking:
        "Before changing anything I want to confirm the failure by actually running the tests.",
      toolCalls: [{ name: "run_command", input: { command: "node test.js" } }],
      delayMs: 750,
    },
    {
      thinking:
        "The assertion failed exactly where I expected: add(2, 3) returned -1. The add function subtracts instead of adding.",
      text: "Found it — add returns a - b instead of a + b. Fixing calc.js now.",
      toolCalls: [
        { name: "write_file", input: { path: "calc.js", content: FIXED_CALC } },
      ],
      delayMs: 900,
    },
    {
      thinking:
        "The fix is written. I never trust a fix I have not verified — rerunning the tests.",
      toolCalls: [{ name: "run_command", input: { command: "node test.js" } }],
      delayMs: 700,
    },
    {
      text: "Fixed the bug in calc.js: the add function was implemented as a - b instead of a + b. All tests now pass.",
      delayMs: 600,
    },
  ];
}
