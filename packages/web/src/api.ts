import type { Provider, RunSummary, TraceEvent } from "./types";

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
  task?: string;
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
