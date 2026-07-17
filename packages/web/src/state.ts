import type { RunSummary, TraceEvent } from "./types";

export interface State {
  runs: RunSummary[];
  runsLoaded: boolean;
  selectedId: string | null;
  /** Trace events for the selected run only. */
  events: TraceEvent[];
  /** Dedupe keys of `events`, so history fetches and live WS pushes merge cleanly. */
  eventKeys: ReadonlySet<string>;
  historyLoading: boolean;
  historyError: string | null;
}

export const initialState: State = {
  runs: [],
  runsLoaded: false,
  selectedId: null,
  events: [],
  eventKeys: new Set<string>(),
  historyLoading: false,
  historyError: null,
};

export type Action =
  | { type: "runs_loaded"; runs: RunSummary[] }
  | { type: "select"; id: string }
  | { type: "deselect" }
  | { type: "history_loaded"; id: string; run: RunSummary; events: TraceEvent[] }
  | { type: "history_failed"; id: string; error: string }
  | { type: "run_created"; run: RunSummary; select: boolean }
  | { type: "trace"; runId: string; event: TraceEvent }
  | { type: "run_updated"; run: RunSummary };

/** Stable identity for a trace event within a single run. */
export function eventKey(e: TraceEvent): string {
  switch (e.type) {
    case "tool_started":
    case "tool_finished":
      return `${e.type}:${e.toolCallId}`;
    case "iteration_started":
    case "model_request":
    case "model_response":
      return `${e.type}:${e.iteration}`;
    case "env_state":
      // Snapshots repeat throughout a run — keyed by emission time.
      return `${e.type}:${e.at}`;
    default:
      // run_started / run_finished occur once per run
      return e.type;
  }
}

function upsertRun(runs: RunSummary[], run: RunSummary): RunSummary[] {
  const i = runs.findIndex((r) => r.id === run.id);
  if (i === -1) {
    return [run, ...runs].sort((a, b) => b.createdAt - a.createdAt);
  }
  const next = runs.slice();
  next[i] = run;
  return next;
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "runs_loaded":
      return { ...state, runs: action.runs, runsLoaded: true };

    case "select":
      if (state.selectedId === action.id) {
        // Re-selecting the current run: refresh in place, keep events to avoid flicker.
        return { ...state, historyLoading: true, historyError: null };
      }
      return {
        ...state,
        selectedId: action.id,
        events: [],
        eventKeys: new Set<string>(),
        historyLoading: true,
        historyError: null,
      };

    case "deselect":
      return {
        ...state,
        selectedId: null,
        events: [],
        eventKeys: new Set<string>(),
        historyLoading: false,
        historyError: null,
      };

    case "history_loaded": {
      const runs = upsertRun(state.runs, action.run);
      if (action.id !== state.selectedId) return { ...state, runs };
      // History is authoritative; keep any live WS events that raced past it.
      const keys = new Set(action.events.map(eventKey));
      const extras = state.events.filter((e) => !keys.has(eventKey(e)));
      for (const e of extras) keys.add(eventKey(e));
      return {
        ...state,
        runs,
        events: [...action.events, ...extras],
        eventKeys: keys,
        historyLoading: false,
        historyError: null,
      };
    }

    case "history_failed":
      if (action.id !== state.selectedId) return state;
      return { ...state, historyLoading: false, historyError: action.error };

    case "run_created": {
      const runs = upsertRun(state.runs, action.run);
      if (!action.select || state.selectedId === action.run.id) {
        return { ...state, runs };
      }
      return {
        ...state,
        runs,
        selectedId: action.run.id,
        events: [],
        eventKeys: new Set<string>(),
        historyLoading: false,
        historyError: null,
      };
    }

    case "trace": {
      if (action.runId !== state.selectedId) return state;
      const key = eventKey(action.event);
      if (state.eventKeys.has(key)) {
        // Duplicate delivery (e.g. history fetch + live push) — keep latest payload.
        return {
          ...state,
          events: state.events.map((e) =>
            eventKey(e) === key ? action.event : e
          ),
        };
      }
      const keys = new Set(state.eventKeys);
      keys.add(key);
      return { ...state, events: [...state.events, action.event], eventKeys: keys };
    }

    case "run_updated":
      return { ...state, runs: upsertRun(state.runs, action.run) };
  }
}
