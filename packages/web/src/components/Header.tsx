import type { RunSummary } from "../types";
import { fmtTokens, statusLabel } from "../format";
import { LogoMark } from "./LogoMark";

interface Props {
  run?: RunSummary;
  connected: boolean;
  onAbort: () => void;
}

export function Header({ run, connected, onAbort }: Props) {
  return (
    <header className="header">
      <div className="wordmark">
        <LogoMark size={20} />
        <span className="wordmark-text">
          Loop<em>Forge</em>
        </span>
      </div>

      <div className="header-right">
        {run && (
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
