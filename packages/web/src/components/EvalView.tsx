import { useMemo } from "react";
import type { EvalRunResult, EvalSummary } from "../types";
import { fmtDuration, fmtTokens, fmtWhen } from "../format";

interface Props {
  evalSummary: EvalSummary;
  /** All known evals — used to build the cross-provider leaderboard for this suite. */
  allEvals: EvalSummary[];
  onOpenRun: (runId: string) => void;
}

/* ---------- header block ---------- */

function EvalHeader({ ev }: { ev: EvalSummary }) {
  const pct = ev.total > 0 ? (ev.done / ev.total) * 100 : 0;
  const running = ev.status === "running";
  return (
    <div className="eval-head">
      <div className="eval-head-top">
        <h1 className="eval-title">{ev.suiteName}</h1>
        <span
          className={"status-pill status-" + (running ? "running" : "completed")}
        >
          <span className="dot" />
          {running ? "running" : "completed"}
        </span>
      </div>

      <div className="eval-head-meta">
        <span className="provider-badge">{ev.provider}</span>
        {ev.model !== null && <span className="mono">{ev.model}</span>}
        <span className="mono">
          {ev.repeats} {ev.repeats === 1 ? "repeat" : "repeats"}
        </span>
        <span className="mono">{fmtWhen(ev.createdAt)}</span>
      </div>

      <div className="progress-row">
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={ev.total}
          aria-valuenow={ev.done}
        >
          <div
            className={"progress-fill" + (running ? " live" : "")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="progress-label mono">
          {ev.done} / {ev.total}
        </span>
      </div>
    </div>
  );
}

/* ---------- aggregate cards ---------- */

function AggregateCards({ ev }: { ev: EvalSummary }) {
  const scored = ev.passed + ev.failed;
  const hasScored = scored > 0;
  const a = ev.aggregate;
  const passW = scored > 0 ? (ev.passed / scored) * 100 : 0;

  return (
    <div className="agg-row">
      <div className="agg-card agg-passrate">
        <span className="agg-label">Pass rate</span>
        <span className="agg-value">
          {hasScored ? `${Math.round(a.passRate * 100)}%` : "—"}
        </span>
        <div className="passfail-bar" aria-hidden="true">
          <span className="pf-pass" style={{ width: `${passW}%` }} />
          <span
            className="pf-fail"
            style={{ width: `${hasScored ? 100 - passW : 0}%` }}
          />
        </div>
        <span className="agg-sub mono">
          {hasScored ? `${ev.passed} pass / ${ev.failed} fail` : "no runs scored"}
        </span>
      </div>

      <div className="agg-card">
        <span className="agg-label">Mean iterations</span>
        <span className="agg-value">
          {hasScored ? a.meanIterations.toFixed(1) : "—"}
        </span>
        <span className="agg-sub mono">over {scored} scored</span>
      </div>

      <div className="agg-card">
        <span className="agg-label">Mean tokens</span>
        <span className="agg-value">
          {hasScored ? fmtTokens(a.meanTokensIn) : "—"}
          <span className="agg-value-sep">/</span>
          {hasScored ? fmtTokens(a.meanTokensOut) : "—"}
        </span>
        <span className="agg-sub mono">in / out</span>
      </div>

      <div className="agg-card">
        <span className="agg-label">Mean duration</span>
        <span className="agg-value">
          {hasScored ? fmtDuration(a.meanDurationMs) : "—"}
        </span>
        <span className="agg-sub mono">per run</span>
      </div>
    </div>
  );
}

/* ---------- results table ---------- */

function ResultRow({
  r,
  onOpen,
}: {
  r: EvalRunResult;
  onOpen: (runId: string) => void;
}) {
  const cls =
    "eval-row" +
    (r.status === "running" ? " running" : "") +
    (r.status === "pending" ? " pending" : "");

  const iterations = r.status === "pending" ? "—" : String(r.iterations);
  const tokens =
    r.status === "pending"
      ? "—"
      : `${fmtTokens(r.usage.inputTokens)} / ${fmtTokens(r.usage.outputTokens)}`;
  const duration = r.durationMs != null ? fmtDuration(r.durationMs) : "—";

  return (
    <tr
      className={cls}
      onClick={() => onOpen(r.runId)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(r.runId);
        }
      }}
    >
      <td className="col-task">
        <span className="task-id">{r.taskId}</span>
      </td>
      <td>
        <span className={`env-badge env-${r.environment}`}>{r.environment}</span>
      </td>
      <td>
        <span className={`eval-status status-${r.status}`}>
          {r.status === "running" && <span className="eval-status-dot" />}
          {r.status}
        </span>
      </td>
      <td className="col-result">
        {r.score ? (
          <span className="result-cell">
            <span
              className={"result-chip " + (r.score.passed ? "pass" : "fail")}
            >
              {r.score.passed ? "PASS" : "FAIL"}
            </span>
            <span className="result-reason">{r.score.reason}</span>
          </span>
        ) : (
          <span className="result-pending">—</span>
        )}
      </td>
      <td className="mono col-num">{iterations}</td>
      <td className="mono col-num">{tokens}</td>
      <td className="mono col-num">{duration}</td>
    </tr>
  );
}

function ResultsTable({
  ev,
  onOpenRun,
}: {
  ev: EvalSummary;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <section className="eval-section">
      <h2 className="section-title">Results</h2>
      <div className="table-scroll">
        <table className="eval-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Env</th>
              <th>Status</th>
              <th>Result</th>
              <th className="col-num">Iterations</th>
              <th className="col-num">Tokens (in/out)</th>
              <th className="col-num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {ev.results.length === 0 ? (
              <tr className="eval-row-empty">
                <td colSpan={7}>Spinning up runs…</td>
              </tr>
            ) : (
              ev.results.map((r) => (
                <ResultRow key={r.runId} r={r} onOpen={onOpenRun} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- leaderboard ---------- */

interface LeaderRow {
  provider: string;
  /** Model override the eval ran with, or null for the provider default. */
  model: string | null;
  passRate: number;
  meanTokensIn: number;
  meanTokensOut: number;
  scored: number;
}

/** Stable identity for a (provider, model) leaderboard entry. */
const leaderKey = (provider: string, model: string | null): string =>
  `${provider}\u0000${model ?? ""}`;

function Leaderboard({
  suiteId,
  allEvals,
}: {
  suiteId: string;
  allEvals: EvalSummary[];
}) {
  const rows = useMemo<LeaderRow[]>(() => {
    // Latest eval per (provider, model) pair for this suite
    // (ascending createdAt → last wins).
    const byKey = new Map<string, EvalSummary>();
    for (const e of allEvals
      .filter((e) => e.suiteId === suiteId)
      .sort((a, b) => a.createdAt - b.createdAt)) {
      byKey.set(leaderKey(e.provider, e.model), e);
    }
    return [...byKey.values()]
      .map((e) => ({
        provider: e.provider,
        model: e.model,
        passRate: e.aggregate.passRate,
        meanTokensIn: e.aggregate.meanTokensIn,
        meanTokensOut: e.aggregate.meanTokensOut,
        scored: e.passed + e.failed,
      }))
      .sort((a, b) => b.passRate - a.passRate);
  }, [suiteId, allEvals]);

  // Only meaningful across multiple (provider, model) entries.
  if (rows.length < 2) return null;

  return (
    <section className="eval-section">
      <h2 className="section-title">Leaderboard</h2>
      <div className="table-scroll">
        <table className="eval-table leaderboard">
          <thead>
            <tr>
              <th className="col-num">#</th>
              <th>Provider</th>
              <th className="col-num">Pass rate</th>
              <th className="col-num">Mean tokens (in/out)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={leaderKey(row.provider, row.model)}>
                <td className="mono col-num col-rank">{i + 1}</td>
                <td>
                  <span className="provider-badge">{row.provider}</span>
                  {row.model !== null && (
                    <span className="mono leader-model"> · {row.model}</span>
                  )}
                </td>
                <td className="mono col-num">
                  {row.scored > 0 ? `${Math.round(row.passRate * 100)}%` : "—"}
                </td>
                <td className="mono col-num">
                  {row.scored > 0
                    ? `${fmtTokens(row.meanTokensIn)} / ${fmtTokens(
                        row.meanTokensOut
                      )}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- view ---------- */

export function EvalView({ evalSummary, allEvals, onOpenRun }: Props) {
  return (
    <div className="eval-view">
      <EvalHeader ev={evalSummary} />
      <AggregateCards ev={evalSummary} />
      <ResultsTable ev={evalSummary} onOpenRun={onOpenRun} />
      <Leaderboard suiteId={evalSummary.suiteId} allEvals={allEvals} />
    </div>
  );
}
