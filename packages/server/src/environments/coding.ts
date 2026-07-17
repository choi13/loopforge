import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodingTools } from "@loopforge/core";
import { DEMO_TASK, buildDemoScript, resetDemoSandbox } from "../demo";
import type { RunEnvironment } from "./index";

/**
 * The coding environment, wrapped in the plugin interface: four sandboxed
 * tools, the coding system prompt, and the scripted bug-fix demo. The tools,
 * prompt, task, and demo behavior are identical to the pre-plugin harness.
 *
 * Isolation: each run operates on its OWN working copy under os.tmpdir()
 * (loopforge-run-<runId>) so parallel coding runs never stomp each other. The
 * copy is seeded from the demo constants (see resetDemoSandbox) — always the
 * BROKEN calc.js plus the tests — not from the on-disk sandbox, so every
 * coding run starts from the same failing state regardless of what a prior run
 * left behind. The temp dir is removed best-effort when the run finishes.
 */

const SYSTEM_PROMPT =
  "You are a coding agent working in a small sandboxed JavaScript project. Use the tools to explore the project, run code, and edit files. The project is plain Node.js with no build step or package manager — run the tests with the command `node test.js` (do NOT use npm/jest). Always verify your changes by running `node test.js` before declaring success; you are done only once it prints that the tests passed. When the task is complete, reply with a brief summary and stop calling tools.";

export function createCodingEnvironment(runId: string): RunEnvironment {
  const sandboxDir = path.join(os.tmpdir(), `loopforge-run-${runId}`);
  // Seed the fresh per-run copy at creation so both mock and manual runs start
  // from the broken sources in an isolated directory.
  resetDemoSandbox(sandboxDir);

  return {
    tools: createCodingTools(sandboxDir),
    systemPrompt: SYSTEM_PROMPT,
    demoTask: DEMO_TASK,
    buildDemoScript,
    prepare: () => resetDemoSandbox(sandboxDir),
    cleanup: () => {
      // Best-effort: never let teardown crash a finished run.
      try {
        rmSync(sandboxDir, { recursive: true, force: true });
      } catch {
        // Ignore — the OS will reclaim tmpdir eventually.
      }
    },
  };
}
