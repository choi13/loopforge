import type { EvalSummary } from "../types";
import { fmtWhen } from "../format";

interface Props {
  evals: EvalSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function EvalList({ evals, selectedId, onSelect }: Props) {
  return (
    <nav className="run-list" aria-label="Evals">
      <h2 className="section-title">Evals</h2>
      {evals.length === 0 ? (
        <p className="run-list-empty">No evals yet.</p>
      ) : (
        <ul>
          {evals.map((ev) => {
            const running = ev.status === "running";
            return (
              <li key={ev.id}>
                <button
                  type="button"
                  className={"run-row" + (ev.id === selectedId ? " active" : "")}
                  onClick={() => onSelect(ev.id)}
                  title={`${ev.suiteName} — ${ev.provider}`}
                >
                  <span
                    className={
                      "status-dot status-" + (running ? "running" : "completed")
                    }
                    role="img"
                    aria-label={running ? "running" : "completed"}
                  />
                  <span className="run-row-main">
                    <span className="run-task">{ev.suiteName}</span>
                    <span className="run-meta">
                      <span className="provider-badge">{ev.provider}</span>
                      <span
                        className="pf-pill"
                        title={`${ev.passed} passed of ${ev.total}`}
                      >
                        {ev.passed}/{ev.total}
                      </span>
                      <span className="run-time">{fmtWhen(ev.createdAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
