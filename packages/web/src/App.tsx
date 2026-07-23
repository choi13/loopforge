import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  abortRun,
  createEval,
  createRun,
  fetchEval,
  fetchEvals,
  fetchHealth,
  fetchRun,
  fetchRuns,
  fetchSuites,
} from "./api";
import { initialState, reducer } from "./state";
import { latestSokobanState } from "./sokoban";
import { latestCodingFilesState } from "./codingFiles";
import { latestBrowserState } from "./browserState";
import { useWebSocket } from "./useWebSocket";
import type {
  Environment,
  Provider,
  ServerMessage,
  Suite,
  View,
  IsolationLevel,
} from "./types";
import { Header } from "./components/Header";
import { NewRunForm } from "./components/NewRunForm";
import { RunList } from "./components/RunList";
import { SokobanBoard } from "./components/SokobanBoard";
import { FileChangesPanel } from "./components/FileChangesPanel";
import { BrowserPanel } from "./components/BrowserPanel";
import { Timeline } from "./components/Timeline";
import { EmptyState } from "./components/EmptyState";
import { NewEvalForm } from "./components/NewEvalForm";
import { EvalList } from "./components/EvalList";
import { EvalView } from "./components/EvalView";

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [evalLoadError, setEvalLoadError] = useState<string | null>(null);
  const [isolationLevel, setIsolationLevel] =
    useState<IsolationLevel>("unknown");

  /** Top-level Runs | Evals view. */
  const [view, setView] = useState<View>("runs");
  /** When a run was opened by drilling into an eval result: the eval to return to. */
  const [fromEvalId, setFromEvalId] = useState<string | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = state.selectedId;
  const selectedEvalIdRef = useRef<string | null>(null);
  selectedEvalIdRef.current = state.selectedEvalId;
  /** True between clicking Start and the run being created — used to auto-select. */
  const justStartedRef = useRef(false);
  const justStartedEvalRef = useRef(false);
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

  /** Fetch the eval list. The detailed results load lazily on selection. */
  const syncEvals = useCallback(async () => {
    try {
      const evals = await fetchEvals();
      dispatch({ type: "evals_loaded", evals });
      // The list is light (results omitted). Re-pull the selected eval's full
      // detail so its results table recovers after a reconnect — otherwise it
      // stays frozen at whatever the last WS push left it.
      const selected = selectedEvalIdRef.current;
      if (selected) {
        try {
          const detail = await fetchEval(selected);
          dispatch({ type: "eval_upsert", eval: detail });
        } catch {
          // Keep the list-form summary; WS pushes will fill it in.
        }
      }
      setEvalLoadError(null);
    } catch (err) {
      setEvalLoadError(
        err instanceof Error ? err.message : "Failed to load evals"
      );
    }
  }, []);

  const selectEval = useCallback(async (id: string) => {
    dispatch({ type: "select_eval", id });
    try {
      // The list form may omit results; pull the full detail for the table.
      const summary = await fetchEval(id);
      dispatch({ type: "eval_upsert", eval: summary });
    } catch {
      // Keep whatever list-form summary we have; WS pushes will fill it in.
    }
  }, []);

  useEffect(() => {
    void sync();
    void syncEvals();
    void fetchHealth()
      .then((health) => setIsolationLevel(health.isolationLevel))
      .catch(() => setIsolationLevel("unknown"));
  }, [sync, syncEvals]);

  // Suites rarely change; fetch once. Failure just leaves the demo fallback.
  useEffect(() => {
    let cancelled = false;
    void fetchSuites()
      .then((s) => {
        if (!cancelled) setSuites(s);
      })
      .catch(() => {
        /* form falls back to the demo suite */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      case "eval_created": {
        const select = justStartedEvalRef.current;
        if (select) justStartedEvalRef.current = false;
        dispatch({ type: "eval_upsert", eval: msg.eval, select });
        break;
      }
      case "eval_updated":
        dispatch({ type: "eval_upsert", eval: msg.eval });
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
    if (connected && !prevConnectedRef.current) {
      void sync();
      void syncEvals();
    }
    prevConnectedRef.current = connected;
  }, [connected, sync, syncEvals]);

  const startRun = useCallback(
    async (
      provider: Provider,
      environment: Environment,
      task: string,
      model: string
    ) => {
      justStartedRef.current = true;
      try {
        const body: {
          provider: Provider;
          environment: Environment;
          task?: string;
          model?: string;
        } = { provider, environment };
        // Mock runs are fully scripted; an empty sokoban/browser task lets
        // the server substitute the standard demo task.
        if (provider !== "mock" && task.length > 0) body.task = task;
        // "model" travels only when a non-empty override was typed; empty
        // means "use the provider default".
        if (provider !== "mock" && model.length > 0) body.model = model;
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

  const startEval = useCallback(
    async (body: {
      suiteId: string;
      provider: Provider;
      repeats: number;
      model?: string;
    }) => {
      justStartedEvalRef.current = true;
      try {
        const summary = await createEval(body);
        justStartedEvalRef.current = false;
        dispatch({ type: "eval_upsert", eval: summary, select: true });
      } catch (err) {
        justStartedEvalRef.current = false;
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

  const changeView = useCallback((v: View) => {
    setView(v);
    // Leaving the drill-down clears the "back to eval" affordance.
    if (v === "evals") setFromEvalId(null);
  }, []);

  /** Drill from an eval result into the underlying run's full trace/board. */
  const openRunFromEval = useCallback(
    (runId: string) => {
      setFromEvalId(selectedEvalIdRef.current);
      setView("runs");
      void selectRun(runId);
    },
    [selectRun]
  );

  const backToEval = useCallback(() => {
    setFromEvalId(null);
    setView("evals");
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
    if (el && stickRef.current && view === "runs") el.scrollTop = el.scrollHeight;
  }, [state.events, view]);

  const selectedRun = state.runs.find((r) => r.id === state.selectedId);
  const isSokoban = selectedRun?.environment === "sokoban";
  const boardState = useMemo(
    () => (isSokoban ? latestSokobanState(state.events) : null),
    [isSokoban, state.events]
  );
  const isCoding = selectedRun?.environment === "coding";
  const filesState = useMemo(
    () => (isCoding ? latestCodingFilesState(state.events) : null),
    [isCoding, state.events]
  );
  const isBrowser = selectedRun?.environment === "browser";
  const browserPanelState = useMemo(
    () => (isBrowser ? latestBrowserState(state.events) : null),
    [isBrowser, state.events]
  );

  // What occupies the sticky side column: sokoban always shows its board and
  // browser runs their live page view (each with a "waiting" placeholder);
  // coding runs show the file-changes panel only once the first coding_files
  // snapshot has arrived.
  const sidePanel = isSokoban ? (
    <SokobanBoard state={boardState} />
  ) : isBrowser ? (
    <BrowserPanel state={browserPanelState} events={state.events} />
  ) : filesState ? (
    <FileChangesPanel state={filesState} />
  ) : null;

  const sortedEvals = useMemo(
    () => Object.values(state.evals).sort((a, b) => b.createdAt - a.createdAt),
    [state.evals]
  );
  const selectedEval = state.selectedEvalId
    ? state.evals[state.selectedEvalId]
    : undefined;

  const runsBody = (
    <>
      {fromEvalId && (
        <div className="back-bar">
          <button type="button" className="back-btn" onClick={backToEval}>
            <span className="back-arrow" aria-hidden="true">
              ‹
            </span>
            Back to eval
          </button>
          <span className="back-bar-label">
            Viewing a single run from an eval batch
          </span>
        </div>
      )}
      {loadError && !state.runsLoaded ? (
        <div className="center-note">
          <div className="inline-error">{loadError}</div>
        </div>
      ) : !state.runsLoaded ? (
        <div className="loading">Loading runs…</div>
      ) : state.runs.length === 0 ? (
        <EmptyState />
      ) : selectedRun ? (
        sidePanel ? (
          <div className="arena-layout">
            <div className="arena-timeline">
              <Timeline
                run={selectedRun}
                events={state.events}
                loading={state.historyLoading}
                error={state.historyError}
              />
            </div>
            <aside
              className={
                "arena-board" +
                (isSokoban ? "" : isBrowser ? " arena-browser" : " arena-files")
              }
            >
              {sidePanel}
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
    </>
  );

  const evalsBody =
    evalLoadError && !state.evalsLoaded ? (
      <div className="center-note">
        <div className="inline-error">{evalLoadError}</div>
      </div>
    ) : !state.evalsLoaded ? (
      <div className="loading">Loading evals…</div>
    ) : sortedEvals.length === 0 ? (
      <div className="empty-wrap">
        <div className="empty-card">
          <h1>No evals yet</h1>
          <p>
            Run the mixed demo suite to see the harness score a batch{" "}
            <strong>(2 pass / 2 fail)</strong> — no API key needed.
          </p>
          <p className="empty-hint">
            Start it from the <strong>New eval</strong> form in the sidebar.
          </p>
        </div>
      </div>
    ) : selectedEval ? (
      <EvalView
        evalSummary={selectedEval}
        allEvals={sortedEvals}
        onOpenRun={openRunFromEval}
      />
    ) : (
      <div className="empty-wrap">
        <div className="empty-card">
          <h1>Select an eval</h1>
          <p>
            Pick a batch from the sidebar to see its progress, results, and
            aggregate stats.
          </p>
          <p className="empty-hint">
            Or start the <strong>mixed demo suite</strong> to watch the harness
            score a fresh batch live.
          </p>
        </div>
      </div>
    );

  return (
    <div className="app">
      <Header
        view={view}
        onViewChange={changeView}
        run={selectedRun}
        connected={connected}
        isolationLevel={isolationLevel}
        onAbort={handleAbort}
      />
      <div className="app-body">
        <aside className="sidebar">
          {view === "runs" ? (
            <>
              <NewRunForm onStart={startRun} />
              <RunList
                runs={state.runs}
                selectedId={state.selectedId}
                onSelect={(id) => void selectRun(id)}
              />
            </>
          ) : (
            <>
              <NewEvalForm suites={suites} onCreate={startEval} />
              <EvalList
                evals={sortedEvals}
                selectedId={state.selectedEvalId}
                onSelect={(id) => void selectEval(id)}
              />
            </>
          )}
        </aside>
        <main className="main" ref={scrollRef} onScroll={handleScroll}>
          {view === "runs" ? runsBody : evalsBody}
        </main>
      </div>
    </div>
  );
}
