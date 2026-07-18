import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AnthropicProvider,
  ClaudeCliProvider,
  OllamaProvider,
  type Tool,
} from "@loopforge/core";
import { ORIGINAL_CALC } from "../demo";
import { createCodingEnvironment } from "./coding";

/** The env_state shape the coding environment publishes after each write. */
interface CodingFilesState {
  kind: string;
  changes: { path: string; before: string | null; after: string }[];
}

function buildEnv() {
  const runId = `test-${randomUUID()}`;
  const sandboxDir = path.join(os.tmpdir(), `loopforge-run-${runId}`);
  const published: CodingFilesState[] = [];
  const env = createCodingEnvironment(runId, (state) => {
    published.push(state as CodingFilesState);
  });
  const tool = (name: string): Tool => {
    const found = env.tools.find((t) => t.name === name);
    assert.ok(found, `tool ${name} should exist`);
    return found;
  };
  return { env, sandboxDir, published, tool };
}

test("write_file publishes cumulative coding_files snapshots with frozen before", async () => {
  const { env, published, tool } = buildEnv();
  try {
    const write = tool("write_file");

    // First write to the seeded calc.js: before is the pre-run broken content.
    const first = await write.execute({ path: "calc.js", content: "// v1\n" });
    assert.notEqual(first.isError, true);
    assert.equal(published.length, 1);
    assert.equal(published[0].kind, "coding_files");
    assert.deepEqual(published[0].changes, [
      { path: "calc.js", before: ORIGINAL_CALC, after: "// v1\n" },
    ]);

    // Second write to the same file: before stays frozen, after advances.
    await write.execute({ path: "calc.js", content: "// v2\n" });
    assert.equal(published.length, 2);
    assert.deepEqual(published[1].changes, [
      { path: "calc.js", before: ORIGINAL_CALC, after: "// v2\n" },
    ]);

    // A brand-new file: before is null; the cumulative list keeps one entry
    // per file, in first-write order.
    await write.execute({ path: "notes.txt", content: "hello" });
    assert.equal(published.length, 3);
    assert.deepEqual(published[2].changes, [
      { path: "calc.js", before: ORIGINAL_CALC, after: "// v2\n" },
      { path: "notes.txt", before: null, after: "hello" },
    ]);

    // Earlier snapshots must not be mutated by later writes.
    assert.equal(published[0].changes[0].after, "// v1\n");
  } finally {
    env.cleanup?.();
  }
});

test("failed writes and non-write tools publish nothing", async () => {
  const { env, published, tool } = buildEnv();
  try {
    const escaped = await tool("write_file").execute({ path: "../escape.txt", content: "x" });
    assert.equal(escaped.isError, true);
    await tool("read_file").execute({ path: "calc.js" });
    await tool("list_files").execute({});
    await tool("run_command").execute({ command: "node test.js" });
    assert.equal(published.length, 0);
  } finally {
    env.cleanup?.();
  }
});

test("before/after longer than 50000 chars are truncated with a suffix", async () => {
  const { env, sandboxDir, published, tool } = buildEnv();
  try {
    // Seed an oversized pre-existing file directly, then overwrite it with
    // oversized new content: both sides must be cut at 50000 chars.
    writeFileSync(path.join(sandboxDir, "big.txt"), "b".repeat(50_050), "utf8");
    await tool("write_file").execute({ path: "big.txt", content: "a".repeat(50_001) });
    assert.equal(published.length, 1);
    const change = published[0].changes[0];
    assert.equal(change.before, `${"b".repeat(50_000)}… (truncated)`);
    assert.equal(change.after, `${"a".repeat(50_000)}… (truncated)`);
  } finally {
    env.cleanup?.();
  }
});

test("OllamaProvider takes the model override as its first constructor argument", () => {
  assert.equal(new OllamaProvider("x").model, "x");
});

test("ClaudeCliProvider takes the model override as its first constructor argument", () => {
  assert.equal(new ClaudeCliProvider("x").model, "x");
});

test("AnthropicProvider takes the model override as its first constructor argument", () => {
  // The SDK client requires a key at construction; no request is ever made.
  process.env.ANTHROPIC_API_KEY ??= "test-key-never-used";
  assert.equal(new AnthropicProvider("x").model, "x");
});
