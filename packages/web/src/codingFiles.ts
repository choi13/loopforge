import type { CodingFilesState, TraceEvent } from "./types";

/**
 * Runtime guard for coding-run env_state payloads. `env_state.state` is
 * `unknown` in the core event type, so the dashboard validates the shape
 * before rendering — a malformed snapshot simply hides the file-changes panel
 * instead of crashing it. Mirrors `isSokobanState`.
 */
export function isCodingFilesState(value: unknown): value is CodingFilesState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s.kind !== "coding_files" || !Array.isArray(s.changes)) return false;
  return s.changes.every((c: unknown) => {
    if (typeof c !== "object" || c === null) return false;
    const ch = c as Record<string, unknown>;
    return (
      typeof ch.path === "string" &&
      (ch.before === null || typeof ch.before === "string") &&
      typeof ch.after === "string"
    );
  });
}

/**
 * The snapshot to render = the latest coding_files env_state in the (ordered)
 * event stream. Scans from the tail so live runs stay O(1) in practice.
 */
export function latestCodingFilesState(
  events: TraceEvent[]
): CodingFilesState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "env_state" && isCodingFilesState(e.state)) return e.state;
  }
  return null;
}
