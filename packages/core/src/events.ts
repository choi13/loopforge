/**
 * Trace events — the observable heartbeat of the agent loop.
 *
 * Every meaningful moment inside a run is emitted as a TraceEvent. The server
 * records and broadcasts them; the dashboard renders them live. This module is
 * pure types with zero runtime dependencies so the browser can import it too.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolCallRef {
  id: string;
  name: string;
  input: unknown;
}

export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "max_iterations";

export type TraceEvent =
  | {
      type: "run_started";
      runId: string;
      task: string;
      provider: string;
      model: string;
      at: number;
    }
  | {
      type: "iteration_started";
      runId: string;
      iteration: number;
      at: number;
    }
  | {
      type: "model_request";
      runId: string;
      iteration: number;
      messageCount: number;
      at: number;
    }
  | {
      type: "model_response";
      runId: string;
      iteration: number;
      thinking?: string;
      text?: string;
      toolCalls: ToolCallRef[];
      usage: TokenUsage;
      at: number;
    }
  | {
      type: "tool_started";
      runId: string;
      iteration: number;
      toolCallId: string;
      name: string;
      input: unknown;
      at: number;
    }
  | {
      type: "tool_finished";
      runId: string;
      iteration: number;
      toolCallId: string;
      name: string;
      output: string;
      isError: boolean;
      durationMs: number;
      at: number;
    }
  | {
      /**
       * Environment-published state snapshot (e.g. a game board). Emitted by
       * the harness around the loop, not by the loop itself — environments
       * push these so UIs can render live state alongside the trace.
       */
      type: "env_state";
      runId: string;
      /** Monotonic per-run sequence so distinct snapshots never collide, even
       *  when two are emitted within the same millisecond. */
      seq: number;
      state: unknown;
      at: number;
    }
  | {
      type: "run_finished";
      runId: string;
      status: Exclude<RunStatus, "running">;
      finalText?: string;
      error?: string;
      iterations: number;
      totalUsage: TokenUsage;
      durationMs: number;
      at: number;
    };
