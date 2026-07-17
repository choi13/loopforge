import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { abortRun, createRun, fetchRun, fetchRuns } from "./api";
import { initialState, reducer } from "./state";
import { latestSokobanState } from "./sokoban";
import { useWebSocket } from "./useWebSocket";
import type { Environment, Provider, ServerMessage } from "./types";
import { Header } from "./components/Header";
import { NewRunForm } from "./components/NewRunForm";
import { RunList } from "./components/RunList";
import { SokobanBoard } from "./components/SokobanBoard";
import { Timeline } from "./components/Timeline";
import { EmptyState } from "./components/EmptyState";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = state.selectedId;
  /** True between clicking Start and the run being created — used to auto-select. */
  const justStartedRef = useRef(false);
  const prevConnectedRef = useRef(false);

  const selectRun = useCallback(async (id: string) => {
    dispatch({ type: "select", id });
    try {
      const { run, events } = await fetchRun(id);
      dispatch({ type: "history_loaded", id, run, events });
    } catch (err) {
      dispatch({
        type: "history_failed",
        id,
        error: err instanceof Error ? err.message : "Failed to load run",
      });
    }
  }, []);

  /** Fetch the run list and (re)select — on boot and whenever the WS reconnects. */
  const sync = useCallback(async () => {
    try {
      const runs = await fetchRuns();
      dispatch({ type: "runs_loaded", runs });
      setLoadError(null);
      const selected = selectedIdRef.current;
      if (selected && runs.some((r) => r.id === selected)) {
        void selectRun(selected);
      } else if (runs.length > 0) {
        void selectRun(runs[0].id);
      } else {
        dispatch({ type: "deselect" });
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to reach the LoopForge server"
      );
    }
  }, [selectRun]);

  useEffect(() => {
    void sync();
  }, [sync]);

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "run_created": {
        const select = justStartedRef.current;
        if (select) justStartedRef.current = false;
        dispatch({ type: "run_created", run: msg.run, select });
        break;
      }
      case "trace":
        dispatch({ type: "trace", runId: msg.runId, event: msg.event });
        break;
      case "run_updated":
        dispatch({ type: "run_updated", run: msg.run });
        break;
    }
  }, []);

  const wsUrl = useMemo(
    () =>
      (window.location.protocol === "https:" ? "wss:" : "ws:") +
      "//" +
      window.location.host +
      "/ws",
    []
  );
  const connected = useWebSocket(wsUrl, handleMessage);

  // Re-sync after a reconnect: WS pushes may have been missed while offline.
  useEffect(() => {
    if (connected && !prevConnectedRef.current) void sync();
    prevConnectedRef.current = connected;
  }, [connected, sync]);

  const startRun = useCallback(
    async (provider: Provider, environment: Environment, task: string) => {
      justStartedRef.current = true;
      try {
        const body: {
          provider: Provider;
          environment: Environment;
          task?: string;
        } = { provider, environment };
        // Mock runs are fully scripted; an empty anthropic+sokoban task lets
        // the server substitute the standard demo task.
        if (provider !== "mock" && task.length > 0) body.task = task;
        const run = await createRun(body);
        justStartedRef.current = false;
        dispatch({ type: "run_created", run, select: true });
      } catch (err) {
        justStartedRef.current = false;
        throw err;
      }
    },
    []
  );

  const handleAbort = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    void abortRun(id).catch(() => {
      // The run may have finished in the meantime; run_updated will settle it.
    });
  }, []);

  // Auto-scroll the timeline while the user is pinned to the bottom.
  const scrollRef = useRef<HTMLElement | null>(null);
  const stickRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    stickRef.current = true;
  }, [state.selectedId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [state.events]);

  const selectedRun = state.runs.find((r) => r.id === state.selectedId);
  const isSokoban = selectedRun?.environment === "sokoban";
  const boardState = useMemo(
    () => (isSokoban ? latestSokobanState(state.events) : null),
    [isSokoban, state.events]
  );

  return (
    <div className="app">
      <Header run={selectedRun} connected={connected} onAbort={handleAbort} />
      <div className="app-body">
        <aside className="sidebar">
          <NewRunForm onStart={startRun} />
          <RunList
            runs={state.runs}
            selectedId={state.selectedId}
            onSelect={(id) => void selectRun(id)}
          />
        </aside>
        <main className="main" ref={scrollRef} onScroll={handleScroll}>
          {loadError && !state.runsLoaded ? (
            <div className="center-note">
              <div className="inline-error">{loadError}</div>
            </div>
          ) : !state.runsLoaded ? (
            <div className="loading">Loading runs…</div>
          ) : state.runs.length === 0 ? (
            <EmptyState />
          ) : selectedRun ? (
            isSokoban ? (
              <div className="arena-layout">
                <div className="arena-timeline">
                  <Timeline
                    run={selectedRun}
                    events={state.events}
                    loading={state.historyLoading}
                    error={state.historyError}
                  />
                </div>
                <aside className="arena-board">
                  <SokobanBoard state={boardState} />
                </aside>
              </div>
            ) : (
              <Timeline
                run={selectedRun}
                events={state.events}
                loading={state.historyLoading}
                error={state.historyError}
              />
            )
          ) : (
            <div className="loading">Select a run from the sidebar.</div>
          )}
        </main>
      </div>
    </div>
  );
}
