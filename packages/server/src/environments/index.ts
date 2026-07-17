import type { MockStep, Tool } from "@loopforge/core";
import { createCodingEnvironment } from "./coding";
import { createSokobanEnvironment } from "./sokoban";

/**
 * Environment plugin seam. An environment supplies everything run-specific
 * that the harness plugs into the agent loop: the tools the model can call,
 * the system prompt, and the scripted demo for mock runs. The factory builds
 * a fresh instance per run so stateful environments (like a Sokoban board)
 * never leak between runs.
 */

export type EnvironmentName = "coding" | "sokoban";

/** Callback the server wires to append + broadcast an env_state trace event. */
export type PublishState = (state: unknown) => void;

export interface RunEnvironment {
  tools: Tool[];
  systemPrompt: string;
  /** Task used for mock runs, and as the fallback when none is provided. */
  demoTask: string;
  /** Script the MockProvider plays back for this environment's demo. */
  buildDemoScript?(): MockStep[];
  /** Reset shared state before a scripted demo run (e.g. the demo sandbox). */
  prepare?(): void;
  /** Called right after run_started is recorded — publish initial state here. */
  onRunStart?(): void;
}

export function createEnvironment(
  name: EnvironmentName,
  publishState: PublishState,
): RunEnvironment {
  switch (name) {
    case "coding":
      return createCodingEnvironment();
    case "sokoban":
      return createSokobanEnvironment(publishState);
  }
}
