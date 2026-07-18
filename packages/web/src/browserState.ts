import type { BrowserState, TraceEvent } from "./types";

/**
 * Runtime guard for browser-run env_state payloads. `env_state.state` is
 * `unknown` in the core event type, so the dashboard validates the shape
 * before rendering — a malformed snapshot degrades to the "waiting for the
 * first page…" placeholder instead of crashing the panel. Mirrors
 * `isSokobanState` / `isCodingFilesState`.
 */
export function isBrowserState(value: unknown): value is BrowserState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    s.kind === "browser" &&
    typeof s.url === "string" &&
    typeof s.title === "string" &&
    typeof s.steps === "number" &&
    typeof s.screenshot === "string"
  );
}

/**
 * The page to render = the latest browser env_state in the (ordered) event
 * stream. Scans from the tail so live runs stay O(1) in practice.
 */
export function latestBrowserState(events: TraceEvent[]): BrowserState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "env_state" && isBrowserState(e.state)) return e.state;
  }
  return null;
}
