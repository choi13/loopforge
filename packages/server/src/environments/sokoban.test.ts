import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SokobanGame,
  SOKOBAN_LEVEL,
  buildSokobanDemoScript,
  type Direction,
} from "./sokoban";

test("fresh game: unsolved, no moves, two boxes and two goals", () => {
  const g = new SokobanGame(SOKOBAN_LEVEL);
  const s = g.state();
  assert.equal(s.solved, false);
  assert.equal(s.moveCount, 0);
  assert.equal(s.boxes.length, 2);
  assert.equal(s.goals.length, 2);
});

test("REGRESSION: the scripted demo solution actually solves the level", () => {
  const moves = buildSokobanDemoScript()
    .flatMap((step) => step.toolCalls ?? [])
    .filter((c) => c.name === "move")
    .map((c) => (c.input as { direction: Direction }).direction);

  const g = new SokobanGame(SOKOBAN_LEVEL);
  for (const d of moves) {
    const r = g.move(d);
    assert.ok(r.ok, `move ${d} should be legal: ${r.description}`);
  }
  assert.equal(g.state().solved, true);
  assert.equal(g.state().moveCount, moves.length);
});

test("walking into a wall is rejected and does not change state", () => {
  const g = new SokobanGame(["###", "#@#", "###"]);
  for (const d of ["up", "down", "left", "right"] as Direction[]) {
    const r = g.move(d);
    assert.equal(r.ok, false, `${d} should be blocked by a wall`);
  }
  assert.equal(g.state().moveCount, 0);
});

test("pushing a box onto a goal solves a one-box level", () => {
  const g = new SokobanGame(["#####", "#@$.#", "#####"]);
  const r = g.move("right");
  assert.ok(r.ok);
  const s = g.state();
  assert.equal(s.solved, true);
  assert.equal(s.moveCount, 1);
});

test("a box cannot be pushed into another box", () => {
  const g = new SokobanGame(["######", "#@$$.#", "######"]);
  const r = g.move("right");
  assert.equal(r.ok, false, "the first box has a second box behind it");
  assert.equal(g.state().moveCount, 0);
});
