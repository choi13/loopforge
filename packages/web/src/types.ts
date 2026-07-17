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

export interface RunSummary {
  id: string;
  task: string;
  provider: string;
  model: string;
  status: RunStatus;
  createdAt: number;
  iterations: number;
  usage: TokenUsage;
}

/** Messages pushed by the server over ws://…/ws */
export type ServerMessage =
  | { type: "run_created"; run: RunSummary }
  | { type: "trace"; runId: string; event: TraceEvent }
  | { type: "run_updated"; run: RunSummary };
