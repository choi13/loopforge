import type { RunFinishedEvent } from "../timeline";
import { fmtDuration, fmtTokens } from "../format";

const TITLES: Record<RunFinishedEvent["status"], string> = {
  completed: "Run completed",
  failed: "Run failed",
  aborted: "Run aborted",
  max_iterations: "Max iterations reached",
};

const TONES: Record<RunFinishedEvent["status"], "ok" | "err" | "warn"> = {
  completed: "ok",
  failed: "err",
  aborted: "warn",
  max_iterations: "warn",
};

interface Props {
  event: RunFinishedEvent;
}

export function FinishBanner({ event }: Props) {
  return (
    <div className={`finish-banner tone-${TONES[event.status]}`}>
      <div className="finish-title">{TITLES[event.status]}</div>
      {event.finalText && <p className="finish-text">{event.finalText}</p>}
      {event.error && <pre className="finish-error">{event.error}</pre>}
      <div className="finish-meta">
        <span>
          {fmtTokens(event.totalUsage.inputTokens)} in /{" "}
          {fmtTokens(event.totalUsage.outputTokens)} out tokens
        </span>
        <span>{fmtDuration(event.durationMs)}</span>
        <span>
          {event.iterations} {event.iterations === 1 ? "iteration" : "iterations"}
        </span>
      </div>
    </div>
  );
}
