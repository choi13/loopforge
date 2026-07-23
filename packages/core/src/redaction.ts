import type { TraceEvent } from "./events";

const MAX_TRACE_STRING_CHARS = 20_000;
const SENSITIVE_KEY =
  /api[_-]?key|token|secret|password|passwd|authorization|cookie/i;
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  ],
  [
    /\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:[^\r\n]+/gi,
    "[REDACTED_HTTP_HEADER]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
  [/\bBasic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]"],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bglpat-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_GITLAB_TOKEN]"],
  [/\bnpm_[A-Za-z0-9]{12,}\b/g, "[REDACTED_NPM_TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED_GOOGLE_API_KEY]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [
    /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY))=([^\s]+)/gi,
    "$1=[REDACTED]",
  ],
  [
    /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/gi,
    "$1[REDACTED]$2",
  ],
  [/\/Users\/[^/\s]+/g, "/Users/[REDACTED]"],
  [/\/home\/[^/\s]+/g, "/home/[REDACTED]"],
];

function redactString(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.length > MAX_TRACE_STRING_CHARS
    ? `${redacted.slice(0, MAX_TRACE_STRING_CHARS)}\n… (trace truncated)`
    : redacted;
}

export function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(item, seen),
    ]),
  );
}

export function redactText(value: string): string {
  return redactString(value);
}

/** Returns a detached, redacted event safe for persistence and broadcast. */
export function redactTraceEvent<T extends TraceEvent>(event: T): T {
  return redactValue(event) as T;
}
