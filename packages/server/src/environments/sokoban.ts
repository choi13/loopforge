import type { MockStep, Tool, ToolResult } from "@loopforge/core";
import type { PublishState, RunEnvironment } from "./index";

/**
 * Sokoban arena: a pure game engine plus the two tools ("look" and "move")
 * that expose it to the model. Every successful move publishes an env_state
 * snapshot so dashboards can render the board live. Proof that the harness is
 * pluggable — nothing in core knows this game exists.
 *
 * ASCII legend: # wall, . goal, $ box, * box on goal, @ player,
 * + player on goal, space floor.
 */

export type Direction = "up" | "down" | "left" | "right";

const DELTAS: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** The exact env_state JSON shape from the server<->web contract. */
export interface SokobanState {
  width: number;
  height: number;
  walls: [number, number][];
  goals: [number, number][];
  boxes: [number, number][];
  player: [number, number];
  moveCount: number;
  solved: boolean;
}

const cellKey = (x: number, y: number): string => `${x},${y}`;

export class SokobanGame {
  private readonly width: number;
  private readonly height: number;
  private readonly walls = new Set<string>();
  private readonly goals = new Set<string>();
  private readonly boxes = new Set<string>();
  private playerX = 0;
  private playerY = 0;
  private moveCount = 0;

  constructor(level: string[]) {
    this.height = level.length;
    this.width = Math.max(...level.map((row) => row.length), 0);
    level.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const ch = row[x];
        if (ch === "#") {
          this.walls.add(cellKey(x, y));
        } else if (ch === ".") {
          this.goals.add(cellKey(x, y));
        } else if (ch === "$") {
          this.boxes.add(cellKey(x, y));
        } else if (ch === "*") {
          this.boxes.add(cellKey(x, y));
          this.goals.add(cellKey(x, y));
        } else if (ch === "@") {
          this.playerX = x;
          this.playerY = y;
        } else if (ch === "+") {
          this.playerX = x;
          this.playerY = y;
          this.goals.add(cellKey(x, y));
        }
      }
    });
  }

  /**
   * Standard rules: the player moves one tile; walking into a box pushes it
   * one tile if the tile behind it is free (not a wall, not another box);
   * otherwise the move is blocked. Boxes can never be pulled.
   */
  move(direction: Direction): { ok: boolean; description: string } {
    const [dx, dy] = DELTAS[direction];
    const targetX = this.playerX + dx;
    const targetY = this.playerY + dy;

    if (this.isWall(targetX, targetY)) {
      return { ok: false, description: "Blocked: a wall is in the way" };
    }

    let pushed = false;
    if (this.boxes.has(cellKey(targetX, targetY))) {
      const behindX = targetX + dx;
      const behindY = targetY + dy;
      if (this.isWall(behindX, behindY) || this.boxes.has(cellKey(behindX, behindY))) {
        return { ok: false, description: "Blocked: cannot push the box" };
      }
      this.boxes.delete(cellKey(targetX, targetY));
      this.boxes.add(cellKey(behindX, behindY));
      pushed = true;
    }

    this.playerX = targetX;
    this.playerY = targetY;
    this.moveCount += 1;
    return {
      ok: true,
      description: pushed ? `Pushed box ${direction}` : `Moved ${direction}`,
    };
  }

  ascii(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y += 1) {
      let row = "";
      for (let x = 0; x < this.width; x += 1) {
        const k = cellKey(x, y);
        const isGoal = this.goals.has(k);
        if (this.walls.has(k)) row += "#";
        else if (this.boxes.has(k)) row += isGoal ? "*" : "$";
        else if (x === this.playerX && y === this.playerY) row += isGoal ? "+" : "@";
        else if (isGoal) row += ".";
        else row += " ";
      }
      rows.push(row);
    }
    return rows.join("\n");
  }

  state(): SokobanState {
    return {
      width: this.width,
      height: this.height,
      walls: this.cellList(this.walls),
      goals: this.cellList(this.goals),
      boxes: this.cellList(this.boxes),
      player: [this.playerX, this.playerY],
      moveCount: this.moveCount,
      solved: this.isSolved(),
    };
  }

  solvedCount(): number {
    let count = 0;
    for (const box of this.boxes) {
      if (this.goals.has(box)) count += 1;
    }
    return count;
  }

  isSolved(): boolean {
    return this.boxes.size > 0 && this.solvedCount() === this.boxes.size;
  }

  /** The status line: "Boxes on goals: n/m", plus " SOLVED!" once complete. */
  status(): string {
    const line = `Boxes on goals: ${this.solvedCount()}/${this.boxes.size}`;
    return this.isSolved() ? `${line} SOLVED!` : line;
  }

  private isWall(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    return this.walls.has(cellKey(x, y));
  }

  private cellList(cells: Set<string>): [number, number][] {
    return [...cells]
      .map((k): [number, number] => {
        const [x, y] = k.split(",").map(Number);
        return [x, y];
      })
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
}

/** The Phase 2 level: 8 wide x 6 tall, two boxes, two goals. */
export const SOKOBAN_LEVEL = [
  "########",
  "#   .  #",
  "#  $$  #",
  "#  @ . #",
  "#      #",
  "########",
];

export const SOKOBAN_DEMO_TASK =
  "Solve the Sokoban puzzle: push both boxes onto the goal tiles.";

const SOKOBAN_SYSTEM_PROMPT =
  "You are playing Sokoban. Push every box ($) onto a goal tile (.). Use the look tool to see the board and the move tool to act. Boxes can only be pushed, never pulled — plan your pushes so you do not trap a box against a wall or corner. The board legend: # wall, . goal, $ box, * box on goal, @ you, + you standing on a goal. When the status line says SOLVED!, reply with a short summary and stop calling tools.";

const LEGEND =
  "Legend: # wall, . goal, $ box, * box on goal, @ player, + player on goal, space floor";

const mv = (direction: Direction) => ({ name: "move", input: { direction } });

/**
 * Scripted demo that genuinely solves the level — every move below executes
 * against the real SokobanGame. 15 moves, verified end-to-end.
 */
export function buildSokobanDemoScript(): MockStep[] {
  return [
    {
      thinking: "Let me look at the board and find the boxes and goals.",
      toolCalls: [{ name: "look", input: {} }],
      delayMs: 600,
    },
    {
      thinking:
        "Two boxes side by side at (3,2) and (4,2); goals at (4,1) and (5,3). The right box sits directly below the top goal — one push up lands it. The left box then has to travel right to column 5 and drop one tile onto the bottom goal. Pushing the right box up first keeps the corridor clear for the left box.",
      text: "Plan: push the right box up onto the top goal first, then push the left box right twice and finish with a single push down onto the bottom goal.",
      toolCalls: [mv("right"), mv("up")],
      delayMs: 700,
    },
    {
      thinking: "First box placed. Now reposition to the left of the remaining box.",
      toolCalls: [mv("down"), mv("left"), mv("left"), mv("up")],
      delayMs: 650,
    },
    {
      thinking: "In position — two pushes right.",
      toolCalls: [mv("right"), mv("right")],
      delayMs: 600,
    },
    {
      thinking:
        "The box sits one tile above its goal. I need to walk around and stand above it to push down.",
      toolCalls: [mv("down"), mv("right"), mv("right"), mv("up"), mv("up"), mv("left")],
      delayMs: 700,
    },
    {
      thinking: "One push down finishes it.",
      toolCalls: [mv("down")],
      delayMs: 600,
    },
    {
      text: "Solved in 15 moves — both boxes are on their goals. Key insight: place the right box on its goal first so it never blocks the corridor while the left box travels right and then down.",
      delayMs: 500,
    },
  ];
}

/**
 * A scripted run that flails and gives up: it looks, makes four legal moves
 * (right, left, up, down) that never place both boxes on goals, then declares
 * defeat. Every move is legal (ok === true) against the real SokobanGame, but
 * the board is never solved, so no env_state with solved:true is ever
 * published and the sokoban scorer must mark this run a FAIL. The move list is
 * verified legal-but-unsolved by a throwaway script during development. Used
 * by the eval suite as the negative case.
 */
export function buildStuckSokobanScript(): MockStep[] {
  return [
    {
      thinking: "Let me look at the board before I move.",
      toolCalls: [{ name: "look", input: {} }],
      delayMs: 500,
    },
    {
      thinking: "Let me shuffle around and see if a path opens up.",
      toolCalls: [mv("right"), mv("left"), mv("up"), mv("down")],
      delayMs: 650,
    },
    {
      text: "I cannot find the solution from here.",
      delayMs: 500,
    },
  ];
}

export function createSokobanEnvironment(publishState: PublishState): RunEnvironment {
  const game = new SokobanGame(SOKOBAN_LEVEL);

  const look: Tool = {
    name: "look",
    description:
      "Look at the Sokoban board. Returns the ASCII board, the legend, and the solve status.",
    inputSchema: { type: "object", properties: {} },
    async execute(): Promise<ToolResult> {
      return { output: `${game.ascii()}\n${LEGEND}\n${game.status()}` };
    },
  };

  const move: Tool = {
    name: "move",
    description:
      "Move the player one tile up, down, left, or right. Walking into a box pushes it one tile if the tile behind it is free. Boxes can never be pulled.",
    inputSchema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Direction to move",
        },
      },
      required: ["direction"],
    },
    async execute(input: { direction?: unknown }): Promise<ToolResult> {
      const direction = input?.direction;
      if (
        direction !== "up" &&
        direction !== "down" &&
        direction !== "left" &&
        direction !== "right"
      ) {
        return {
          output: `Invalid direction: ${JSON.stringify(direction)}. Use "up", "down", "left", or "right".`,
          isError: true,
        };
      }
      const result = game.move(direction);
      if (!result.ok) {
        return { output: result.description, isError: true };
      }
      publishState(game.state());
      return { output: `${result.description}\n${game.ascii()}\n${game.status()}` };
    },
  };

  return {
    tools: [look, move],
    systemPrompt: SOKOBAN_SYSTEM_PROMPT,
    demoTask: SOKOBAN_DEMO_TASK,
    buildDemoScript: buildSokobanDemoScript,
    onRunStart: () => publishState(game.state()),
  };
}
