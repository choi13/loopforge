import type { IsolationLevel, RunSummary, View } from "../types";
import { fmtTokens, statusLabel } from "../format";
import { LogoMark } from "./LogoMark";

interface Props {
  view: View;
  onViewChange: (view: View) => void;
  run?: RunSummary;
  connected: boolean;
  isolationLevel: IsolationLevel;
  onAbort: () => void;
}

export function Header({
  view,
  onViewChange,
  run,
  connected,
  isolationLevel,
  onAbort,
}: Props) {
  const showRun = view === "runs" && run;
  return (
    <header className="header">
      <div className="wordmark">
        <LogoMark size={20} />
        <span className="wordmark-text">
          Loop<em>Forge</em>
        </span>
      </div>

      <div className="view-switch" role="tablist" aria-label="Dashboard view">
        {(["runs", "evals"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={"seg" + (view === v ? " active" : "")}
            onClick={() => onViewChange(v)}
          >
            {v === "runs" ? "Runs" : "Evals"}
          </button>
        ))}
      </div>

      <div className="header-right">
        <span
          className={`isolation-pill isolation-${isolationLevel}`}
          title="Command execution isolation level reported by the local server"
        >
          isolation: {isolationLevel}
        </span>
        {showRun && (
          <>
            <span className={`status-pill status-${run.status}`}>
              <span className="dot" />
              {statusLabel(run.status)}
            </span>
            <span
              className="header-tokens"
              title="Total tokens for the selected run"
            >
              <span className="tok-label">tokens</span>
              <span className="tok-val">{fmtTokens(run.usage.inputTokens)} in</span>
              <span className="tok-sep">/</span>
              <span className="tok-val">
                {fmtTokens(run.usage.outputTokens)} out
              </span>
            </span>
            {run.status === "running" && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={onAbort}
              >
                Abort
              </button>
            )}
            <span className="header-divider" aria-hidden="true" />
          </>
        )}
        <div
          className={"conn" + (connected ? " ok" : "")}
          title={
            connected
              ? "WebSocket connected"
              : "WebSocket disconnected — reconnecting"
          }
        >
          <span className="conn-dot" />
          <span className="conn-label">{connected ? "live" : "offline"}</span>
        </div>
      </div>
    </header>
  );
}
