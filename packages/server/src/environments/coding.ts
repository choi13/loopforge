import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCodingTools } from "@loopforge/core";
import { DEMO_TASK, buildDemoScript, resetDemoSandbox } from "../demo";
import type { RunEnvironment } from "./index";

/**
 * The original coding environment, wrapped in the plugin interface: four
 * sandboxed tools, the coding system prompt, and the scripted bug-fix demo.
 * Behavior is identical to the pre-plugin harness.
 */

// This file is at packages/server/src/environments — four levels up is the repo root.
const SANDBOX_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "sandbox",
  "demo-project",
);

const SYSTEM_PROMPT =
  "You are a coding agent working in a small sandboxed JavaScript project. Use the tools to explore the project, run code, and edit files. Always verify your changes by running the tests before declaring success. When the task is complete, reply with a brief summary and stop calling tools.";

export function createCodingEnvironment(): RunEnvironment {
  return {
    tools: createCodingTools(SANDBOX_DIR),
    systemPrompt: SYSTEM_PROMPT,
    demoTask: DEMO_TASK,
    buildDemoScript,
    prepare: () => resetDemoSandbox(SANDBOX_DIR),
  };
}
