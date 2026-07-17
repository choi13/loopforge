import { useMemo } from "react";
import type { SokobanState } from "../types";

/** Tile edge length in px — keep in sync with --sokoban-tile in styles.css. */
const TILE = 36;

const posKey = (x: number, y: number): string => `${x},${y}`;

interface BoardProps {
  state: SokobanState;
}

/**
 * The board itself: a static CSS-grid layer (walls / floors / goal rings) with
 * the moving pieces (boxes, player) absolutely positioned on top. Pieces are
 * placed with transform: translate(...) so successive env_state snapshots
 * animate as smooth slides rather than re-mounts.
 */
function Board({ state }: BoardProps) {
  const walls = useMemo(
    () => new Set(state.walls.map(([x, y]) => posKey(x, y))),
    [state.walls]
  );
  const goals = useMemo(
    () => new Set(state.goals.map(([x, y]) => posKey(x, y))),
    [state.goals]
  );

  const tiles = [];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const k = posKey(x, y);
      const kind = walls.has(k) ? "wall" : goals.has(k) ? "goal" : "floor";
      tiles.push(<div key={k} className={`sk-tile sk-${kind}`} />);
    }
  }

  const [px, py] = state.player;

  return (
    <div className="sk-scroll">
      <div
        className="sk-grid"
        role="img"
        aria-label={`Sokoban board, ${state.width} by ${state.height}`}
        style={{
          gridTemplateColumns: `repeat(${state.width}, ${TILE}px)`,
          gridTemplateRows: `repeat(${state.height}, ${TILE}px)`,
        }}
      >
        {tiles}
        {state.boxes.map(([x, y], i) => (
          <div
            key={`box-${i}`}
            className={
              "sk-piece sk-box" + (goals.has(posKey(x, y)) ? " on-goal" : "")
            }
            style={{ transform: `translate(${x * TILE}px, ${y * TILE}px)` }}
          >
            <div className="sk-box-face" />
          </div>
        ))}
        <div
          className="sk-piece sk-player"
          style={{ transform: `translate(${px * TILE}px, ${py * TILE}px)` }}
        >
          <div className="sk-player-face" />
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="sk-legend">
      <span className="sk-legend-item">
        <span className="sk-swatch sk-swatch-goal" />
        goal
      </span>
      <span className="sk-legend-item">
        <span className="sk-swatch sk-swatch-box" />
        box
      </span>
      <span className="sk-legend-item">
        <span className="sk-swatch sk-swatch-box-goal" />
        box on goal
      </span>
      <span className="sk-legend-item">
        <span className="sk-swatch sk-swatch-player" />
        player
      </span>
    </div>
  );
}

interface Props {
  /** Latest env_state snapshot for the selected run, or null before the first one. */
  state: SokobanState | null;
}

export function SokobanBoard({ state }: Props) {
  return (
    <section className="sk-panel" aria-label="Sokoban board">
      <header className="sk-head">
        <span className="sk-title">Sokoban</span>
        {state?.solved && <span className="sk-solved">SOLVED</span>}
        {state && (
          <span className="sk-moves">
            {state.moveCount} {state.moveCount === 1 ? "move" : "moves"}
          </span>
        )}
      </header>

      {state ? (
        <>
          <Board state={state} />
          <Legend />
        </>
      ) : (
        <div className="sk-waiting">waiting for board…</div>
      )}
    </section>
  );
}
