import type {
  Environment,
  EvalSummary,
  Provider,
  RunSummary,
  IsolationLevel,
  Suite,
  TraceEvent,
} from "./types";

export async function fetchHealth(): Promise<{
  ok: boolean;
  bindHost: string;
  isolationLevel: Exclude<IsolationLevel, "unknown">;
}> {
  return request("/api/health");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.length > 0) {
        message = body.error;
      }
    } catch {
      // non-JSON error body — keep the status message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchRuns(): Promise<RunSummary[]> {
  const data = await request<{ runs: RunSummary[] }>("/api/runs");
  return data.runs;
}

export async function fetchRun(
  id: string
): Promise<{ run: RunSummary; events: TraceEvent[] }> {
  return request<{ run: RunSummary; events: TraceEvent[] }>(
    `/api/runs/${encodeURIComponent(id)}`
  );
}

export async function createRun(body: {
  provider: Provider;
  environment: Environment;
  task?: string;
  /** Optional per-provider model override; omit to use the provider default. */
  model?: string;
}): Promise<RunSummary> {
  const data = await request<{ run: RunSummary }>("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return data.run;
}

export async function abortRun(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}/abort`, {
    method: "POST",
  });
}

/* ---------- evals ---------- */

/**
 * The list endpoint may omit `results` to stay light; the detail endpoint and
 * WS pushes always include it. Normalize so the client can treat `results` as a
 * present array everywhere.
 */
function normalizeEval(e: EvalSummary): EvalSummary {
  return { ...e, results: e.results ?? [], model: e.model ?? null };
}

export async function fetchSuites(): Promise<Suite[]> {
  const data = await request<{ suites: Suite[] }>("/api/suites");
  return data.suites;
}

export async function fetchEvals(): Promise<EvalSummary[]> {
  const data = await request<{ evals: EvalSummary[] }>("/api/evals");
  return data.evals.map(normalizeEval);
}

export async function fetchEval(id: string): Promise<EvalSummary> {
  const data = await request<{ eval: EvalSummary }>(
    `/api/evals/${encodeURIComponent(id)}`
  );
  return normalizeEval(data.eval);
}

export async function createEval(body: {
  suiteId: string;
  provider: Provider;
  repeats: number;
  /** Optional per-provider model override; omit to use the provider default. */
  model?: string;
}): Promise<EvalSummary> {
  const data = await request<{ eval: EvalSummary }>("/api/evals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return normalizeEval(data.eval);
}
