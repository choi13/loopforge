import type { RunStatus } from "./types";

/** 340 -> "340", 1234 -> "1.2k", 128000 -> "128k" */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(n);
  const k = n / 1000;
  return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
}

/** 142 -> "142 ms", 3480 -> "3.5 s", 96000 -> "1m 36s" */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Relative for the last hour, HH:MM for today, "Mon D HH:MM" otherwise. */
export function fmtWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  const d = new Date(ts);
  const now = new Date();
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hhmm;
  return `${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} ${hhmm}`;
}

export function statusLabel(status: RunStatus): string {
  return status === "max_iterations" ? "max iterations" : status;
}
