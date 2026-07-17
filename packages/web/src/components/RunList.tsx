import type { RunSummary } from "../types";
import { fmtWhen, statusLabel } from "../format";

interface Props {
  runs: RunSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

export function RunList({ runs, selectedId, onSelect }: Props) {
  return (
    <nav className="run-list" aria-label="Runs">
      <h2 className="section-title">Runs</h2>
      {runs.length === 0 ? (
        <p className="run-list-empty">No runs yet.</p>
      ) : (
        <ul>
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className={"run-row" + (run.id === selectedId ? " active" : "")}
                onClick={() => onSelect(run.id)}
                title={run.task}
              >
                <span
                  className={`status-dot status-${run.status}`}
                  role="img"
                  aria-label={statusLabel(run.status)}
                />
                <span className="run-row-main">
                  <span className="run-task">{truncate(run.task, 60)}</span>
                  <span className="run-meta">
                    <span className="provider-badge">{run.provider}</span>
                    <span className={`env-badge env-${run.environment}`}>
                      {run.environment}
                    </span>
                    <span className="run-time">{fmtWhen(run.createdAt)}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
