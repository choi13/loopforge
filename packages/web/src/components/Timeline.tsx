import { useMemo } from "react";
import type { RunSummary, TraceEvent } from "../types";
import { buildTimeline } from "../timeline";
import { IterationCard } from "./IterationCard";
import { FinishBanner } from "./FinishBanner";

interface Props {
  run: RunSummary;
  events: TraceEvent[];
  loading: boolean;
  error: string | null;
}

export function Timeline({ run, events, loading, error }: Props) {
  const vm = useMemo(() => buildTimeline(events), [events]);
  const loadingEmpty = loading && events.length === 0;

  return (
    <div className="timeline">
      <div className="run-head">
        <div className="run-head-task">{run.task}</div>
        <div className="run-head-meta">
          <span className="provider-badge">{run.provider}</span>
          <span className={`env-badge env-${run.environment}`}>
            {run.environment}
          </span>
          <span className="mono">{run.model}</span>
          <span className="mono">
            {run.iterations} {run.iterations === 1 ? "iteration" : "iterations"}
          </span>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {loadingEmpty && <div className="loading">Loading trace…</div>}

      {vm.iterations.map((iteration) => (
        <IterationCard key={iteration.n} iteration={iteration} />
      ))}

      {vm.finished && <FinishBanner event={vm.finished} />}

      {!vm.finished && run.status === "running" && !loadingEmpty && (
        <div className="waiting">agent loop in progress…</div>
      )}
    </div>
  );
}
