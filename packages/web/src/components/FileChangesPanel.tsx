import { useMemo } from "react";
import type { CodingFileChange, CodingFilesState } from "../types";
import { collapseContext, computeLineDiff } from "../diff";
import type { DiffRow } from "../diff";

const SIGNS = { add: "+", del: "-", ctx: " " } as const;

/**
 * Unified line diff of one file's before -> after. Recomputed only when the
 * content strings actually change (snapshots are cumulative, so untouched
 * files keep referentially-comparable equal strings across updates).
 */
function DiffBody({ change }: { change: CodingFileChange }) {
  const rows = useMemo<DiffRow[]>(
    () => collapseContext(computeLineDiff(change.before ?? "", change.after)),
    [change.before, change.after]
  );

  return (
    <pre className="fc-diff">
      {rows.map((row, i) =>
        row.type === "skip" ? (
          <span key={i} className="fc-skip">
            ⋯ {row.count} unchanged {row.count === 1 ? "line" : "lines"}
          </span>
        ) : (
          <span key={i} className={`fc-line fc-${row.type}`}>
            <span className="fc-sign" aria-hidden="true">
              {SIGNS[row.type]}
            </span>
            {row.text}
          </span>
        )
      )}
    </pre>
  );
}

interface Props {
  /** Latest coding_files env_state snapshot for the selected run. */
  state: CodingFilesState;
}

/**
 * Side panel for coding runs: one card per file the agent has written, each
 * showing a collapsed unified diff of before -> after. Lives in the same
 * layout slot the Sokoban board uses and updates live as snapshots arrive.
 */
export function FileChangesPanel({ state }: Props) {
  const n = state.changes.length;
  return (
    <section className="fc-panel" aria-label="File changes">
      <header className="fc-head">
        <span className="fc-title">File changes</span>
        <span className="fc-count">
          {n} {n === 1 ? "file" : "files"}
        </span>
      </header>

      {state.changes.map((change) => (
        <article className="fc-card" key={change.path}>
          <header className="fc-card-head">
            <span className="fc-path">{change.path}</span>
            {change.before === null && (
              <span className="fc-new-badge">new file</span>
            )}
          </header>
          <DiffBody change={change} />
        </article>
      ))}
    </section>
  );
}
