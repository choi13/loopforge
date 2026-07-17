import { LogoMark } from "./LogoMark";

export function EmptyState() {
  return (
    <div className="empty-wrap">
      <div className="empty-card">
        <div className="empty-mark">
          <LogoMark size={36} />
        </div>
        <h1>Watch an agent loop run, live</h1>
        <p>
          LoopForge streams every iteration of an agent loop — model thinking,
          tool calls, and results — the moment they happen.
        </p>
        <p className="empty-hint">
          Start the <strong>mock demo run</strong> from the sidebar to see it in
          action — or pick the <strong>Sokoban arena</strong> to watch the agent
          solve a puzzle on a live board. No API key needed.
        </p>
      </div>
    </div>
  );
}
