import assert from "node:assert/strict";
import test from "node:test";
import { redactTraceEvent, redactValue } from "./redaction";
import type { TraceEvent } from "./events";

test("trace redaction masks keyed and inline secrets before storage", () => {
  const event: TraceEvent = {
    type: "tool_started",
    runId: "r1",
    iteration: 1,
    toolCallId: "t1",
    name: "run_command",
    input: {
      apiKey: "top-secret",
      command:
        "echo Bearer abc.def.ghi ghp_1234567890abcdef /Users/alice/project",
    },
    at: 1,
  };

  const safe = redactTraceEvent(event);
  const json = JSON.stringify(safe);

  assert.doesNotMatch(json, /top-secret|abc\.def\.ghi|ghp_|\/Users\/alice/);
  assert.match(json, /\[REDACTED\]/);
  assert.match(json, /\/Users\/\[REDACTED\]/);
  assert.equal((event.input as { apiKey: string }).apiKey, "top-secret");
});

test("redaction truncates oversized strings and handles circular values", () => {
  const circular: Record<string, unknown> = { output: "x".repeat(25_000) };
  circular.self = circular;
  const safe = redactValue(circular) as Record<string, string>;

  assert.match(safe.output, /trace truncated/);
  assert.equal(safe.self, "[CIRCULAR]");
});

test("redaction covers headers, credential URLs, provider tokens, and private keys", () => {
  const raw = [
    "Authorization: Basic YWRtaW46c2VjcmV0",
    "postgres://app:database-password@localhost/db",
    "xoxb-123456789012-abcdefghijkl",
    "glpat-abcdefghijklmnop",
    "-----BEGIN PRIVATE KEY-----",
    "very-private-material",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const safe = redactValue(raw) as string;

  assert.doesNotMatch(
    safe,
    /YWRtaW46|database-password|xoxb-|glpat-|very-private-material/,
  );
  assert.match(safe, /REDACTED_HTTP_HEADER/);
  assert.match(safe, /REDACTED_PRIVATE_KEY/);
});
