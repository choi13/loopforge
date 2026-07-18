import { useMemo } from "react";
import type { BrowserState, TraceEvent } from "../types";

/** Exact marker the seeded shop's broken POST /order page always contains. */
const BUG_MARKER = "Internal Server Error (500)";

/**
 * True once the agent has actually exercised the planted bug: any successful
 * `click` tool result in the run whose output contains the 500 marker.
 * Mirrors the server-side browser scorer.
 */
function bugObserved(events: TraceEvent[]): boolean {
  return events.some(
    (e) =>
      e.type === "tool_finished" &&
      e.name === "click" &&
      !e.isError &&
      e.output.includes(BUG_MARKER)
  );
}

interface Props {
  /** Latest browser env_state snapshot for the selected run, or null before the first one. */
  state: BrowserState | null;
  /** Full event stream of the selected run — used to detect the observed bug. */
  events: TraceEvent[];
}

/**
 * Side panel for browser (web-QA) runs: the live URL readout, the latest
 * viewport screenshot, a step counter, and a red "BUG OBSERVED" chip once a
 * successful click surfaced the seeded 500. Lives in the same layout slot the
 * Sokoban board uses and updates live as env_state snapshots arrive.
 */
export function BrowserPanel({ state, events }: Props) {
  const bug = useMemo(() => bugObserved(events), [events]);

  return (
    <section className="bp-panel" aria-label="Browser view">
      <header className="bp-head">
        <span className="bp-title">Browser</span>
        {bug && <span className="bp-bug">BUG OBSERVED</span>}
        {state && (
          <span className="bp-steps">
            {state.steps} {state.steps === 1 ? "step" : "steps"}
          </span>
        )}
      </header>

      {state ? (
        <>
          <div className="bp-url" title={state.url}>
            {state.url}
          </div>
          <img
            className="bp-shot"
            src={state.screenshot}
            alt={
              state.title
                ? `Screenshot of "${state.title}"`
                : "Page screenshot"
            }
          />
        </>
      ) : (
        <div className="bp-waiting">waiting for the first page…</div>
      )}
    </section>
  );
}
