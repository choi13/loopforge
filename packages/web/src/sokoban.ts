import type { SokobanState, TraceEvent } from "./types";

/**
 * Runtime guard for env_state payloads. `env_state.state` is `unknown` in the
 * core event type, so the dashboard validates the shape before rendering —
 * a malformed snapshot degrades to the "waiting for board" placeholder
 * instead of crashing the board panel.
 */
export function isSokobanState(value: unknown): value is SokobanState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const isPair = (p: unknown): boolean =>
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number";
  return (
    typeof s.width === "number" &&
    typeof s.height === "number" &&
    s.width > 0 &&
    s.height > 0 &&
    Array.isArray(s.walls) &&
    s.walls.every(isPair) &&
    Array.isArray(s.goals) &&
    s.goals.every(isPair) &&
    Array.isArray(s.boxes) &&
    s.boxes.every(isPair) &&
    isPair(s.player) &&
    typeof s.moveCount === "number" &&
    typeof s.solved === "boolean"
  );
}

/**
 * The board to render = the latest env_state snapshot in the (ordered) event
 * stream. Scans from the tail so live runs stay O(1) in practice.
 */
export function latestSokobanState(events: TraceEvent[]): SokobanState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "env_state" && isSokobanState(e.state)) return e.state;
  }
  return null;
}
