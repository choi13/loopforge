import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeRunTask } from "./run-manager";

test("run summaries redact task secrets before API or WebSocket exposure", () => {
  const task =
    "debug Authorization: Bearer abcdefghijklmnop and /Users/alice/project";
  const safe = sanitizeRunTask(task);
  assert.doesNotMatch(safe, /abcdefghijklmnop/);
  assert.doesNotMatch(safe, /alice/);
  assert.match(safe, /REDACTED/);
});
