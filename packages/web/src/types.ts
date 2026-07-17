/**
 * Shared client-side types.
 *
 * Core trace types are imported TYPE-ONLY from the core package (safe: type
 * imports are erased at build time, so no Node-only code reaches the browser).
 * RunSummary and the WebSocket message union mirror the server API contract.
 */
import type { TraceEvent, TokenUsage, RunStatus } from "../../core/src/events";

export type { TraceEvent, TokenUsage, RunStatus, ToolCallRef } from "../../core/src/events";

export type Provider = "mock" | "anthropic";

export type Environment = "coding" | "sokoban";

export interface RunSummary {
  id: string;
  task: string;
  provider: string;
  environment: Environment;
  model: string;
  status: RunStatus;
  createdAt: number;
  iterations: number;
  usage: TokenUsage;
}

/**
 * Payload of `env_state` events for sokoban runs. Coordinates are
 * [x, y] pairs — x = column from the left, y = row from the top, 0-based.
 */
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

/** Messages pushed by the server over ws://…/ws */
export type ServerMessage =
  | { type: "run_created"; run: RunSummary }
  | { type: "trace"; runId: string; event: TraceEvent }
  | { type: "run_updated"; run: RunSummary };
