import type { MockStep } from "@loopforge/core";
import { buildDemoScript, buildLazyCodingScript } from "./demo";
import {
  buildBrowserDemoScript,
  buildStuckBrowserScript,
} from "./environments/browser";
import { buildSokobanDemoScript, buildStuckSokobanScript } from "./environments/sokoban";

/**
 * Registry of the scripted mock runs the eval suite can play back. Each key
 * selects a MockStep[] builder: positive cases that succeed and negative cases
 * that fail (a lazy coding run that leaves the bug in place, a stuck sokoban
 * run that never solves the board, a shallow QA run that never reaches the
 * broken order flow). The eval layer maps a suite task to a scriptKey and
 * hands the built steps to a MockProvider.
 */
export type ScriptKey =
  | "coding-solve"
  | "coding-lazy"
  | "sokoban-solve"
  | "sokoban-stuck"
  | "browser-find-bug"
  | "browser-miss-bug";

export const MOCK_SCRIPTS: Record<ScriptKey, () => MockStep[]> = {
  "coding-solve": buildDemoScript,
  "coding-lazy": buildLazyCodingScript,
  "sokoban-solve": buildSokobanDemoScript,
  "sokoban-stuck": buildStuckSokobanScript,
  "browser-find-bug": buildBrowserDemoScript,
  "browser-miss-bug": buildStuckBrowserScript,
};

/** Build the MockStep[] for a script key, throwing on an unknown key. */
export function buildMockScript(key: ScriptKey): MockStep[] {
  const builder = MOCK_SCRIPTS[key];
  if (!builder) throw new Error(`Unknown mock script key: ${key}`);
  return builder();
}
