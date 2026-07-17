import { useState } from "react";
import type { IterationVM } from "../timeline";
import { fmtTokens } from "../format";
import { ToolCard } from "./ToolCard";

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="thinking">
      <button
        type="button"
        className="thinking-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={"chev" + (open ? " open" : "")} aria-hidden="true" />
        thinking
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}

interface Props {
  iteration: IterationVM;
}

export function IterationCard({ iteration }: Props) {
  const { n, messageCount, usage, thinking, text, tools } = iteration;
  return (
    <section className="iter-card">
      <header className="iter-head">
        <span className="iter-title">Iteration {n}</span>
        <span className="iter-meta">
          {messageCount !== undefined && (
            <span>
              {messageCount} {messageCount === 1 ? "msg" : "msgs"}
            </span>
          )}
          {usage && (
            <span>
              in {fmtTokens(usage.inputTokens)} / out{" "}
              {fmtTokens(usage.outputTokens)}
            </span>
          )}
        </span>
      </header>

      {thinking && <ThinkingBlock text={thinking} />}
      {text && <p className="assistant-text">{text}</p>}
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}
    </section>
  );
}
