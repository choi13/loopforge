import type { MockStep } from "@loopforge/core";
import { buildDemoScript, buildLazyCodingScript } from "./demo";
import { buildSokobanDemoScript, buildStuckSokobanScript } from "./environments/sokoban";

/**
 * Registry of the scripted mock runs the eval suite can play back. Each key
 * selects a MockStep[] builder: two positive cases that succeed and two
 * negative cases that fail (a lazy coding run that leaves the bug in place, a
 * stuck sokoban run that never solves the board). The eval layer maps a suite
 * task to a scriptKey and hands the built steps to a MockProvider.
 */
export type ScriptKey =
  | "coding-solve"
  | "coding-lazy"
  | "sokoban-solve"
  | "sokoban-stuck";

export const MOCK_SCRIPTS: Record<ScriptKey, () => MockStep[]> = {
  "coding-solve": buildDemoScript,
  "coding-lazy": buildLazyCodingScript,
  "sokoban-solve": buildSokobanDemoScript,
  "sokoban-stuck": buildStuckSokobanScript,
};

/** Build the MockStep[] for a script key, throwing on an unknown key. */
export function buildMockScript(key: ScriptKey): MockStep[] {
  const builder = MOCK_SCRIPTS[key];
  if (!builder) throw new Error(`Unknown mock script key: ${key}`);
  return builder();
}
