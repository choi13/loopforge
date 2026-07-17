import type { ToolVM } from "../timeline";
import { fmtDuration } from "../format";
import { JsonBlock } from "./JsonBlock";

interface Props {
  tool: ToolVM;
}

export function ToolCard({ tool }: Props) {
  const failed = tool.done && tool.isError === true;
  return (
    <div
      className={
        "tool-card" + (failed ? " error" : "") + (!tool.done ? " live" : "")
      }
    >
      <div className="tool-head">
        <span className="tool-badge">{tool.name}</span>
        {tool.done ? (
          <span className="duration-badge">
            {fmtDuration(tool.durationMs ?? 0)}
          </span>
        ) : (
          <span className="running-chip">
            <span className="running-dot" />
            running…
          </span>
        )}
      </div>

      {tool.hasInput && (
        <div className="tool-section">
          <span className="micro-label">input</span>
          <JsonBlock value={tool.input} />
        </div>
      )}

      {tool.done && (
        <div className="tool-section">
          <span className={"micro-label" + (failed ? " error-label" : "")}>
            {failed ? "error" : "output"}
          </span>
          <pre className={"tool-output" + (failed ? " is-error" : "")}>
            {tool.output}
          </pre>
        </div>
      )}
    </div>
  );
}
