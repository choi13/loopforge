import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tool } from "@loopforge/core";
import {
  BROWSER_DEMO_TASK,
  buildBrowserDemoScript,
  buildStuckBrowserScript,
  createBrowserEnvironment,
} from "./browser";

/**
 * Browser environment tests that never touch Playwright: construction is
 * cheap (the browser launches lazily on first tool use) and the goto origin
 * allowlist rejects foreign URLs BEFORE any launch is attempted.
 */

function buildEnv() {
  const published: unknown[] = [];
  const env = createBrowserEnvironment((state) => published.push(state));
  const tool = (name: string): Tool => {
    const found = env.tools.find((t) => t.name === name);
    assert.ok(found, `tool ${name} should exist`);
    return found;
  };
  return { env, published, tool };
}

test("exposes the four QA tools and the demo task", () => {
  const { env } = buildEnv();
  assert.deepEqual(
    env.tools.map((t) => t.name),
    ["goto", "read_page", "click", "fill"],
  );
  assert.equal(env.demoTask, BROWSER_DEMO_TASK);
  assert.equal(env.buildDemoScript, buildBrowserDemoScript);
  assert.equal(typeof env.cleanup, "function");
});

test("goto rejects non-sandbox origins without launching a browser", async () => {
  const { published, tool } = buildEnv();
  const goto = tool("goto");
  for (const url of [
    "https://example.com",
    "http://localhost:9999/",
    "https://localhost:8788/", // wrong protocol => different origin
  ]) {
    const result = await goto.execute({ url });
    assert.equal(result.isError, true, `${url} must be blocked`);
    assert.equal(result.output, "This QA sandbox can only visit http://localhost:8788");
  }
  assert.equal(published.length, 0, "blocked navigations publish no env_state");
});

test("goto rejects missing or malformed urls", async () => {
  const { tool } = buildEnv();
  const goto = tool("goto");
  assert.equal((await goto.execute({})).isError, true);
  assert.equal((await goto.execute({ url: "not a url" })).isError, true);
});

test("click and fill validate their inputs without launching a browser", async () => {
  const { tool } = buildEnv();
  assert.equal((await tool("click").execute({})).isError, true);
  assert.equal((await tool("fill").execute({ field: "Your name" })).isError, true);
  assert.equal((await tool("fill").execute({ value: "x" })).isError, true);
});

test("the q1 script observes the bug via Place order; q2 only browses", () => {
  const q1 = buildBrowserDemoScript();
  const q1Calls = q1.flatMap((step) => step.toolCalls ?? []);
  assert.equal(q1Calls[0].name, "goto");
  assert.ok(
    q1Calls.some(
      (c) => c.name === "click" && (c.input as { text: string }).text === "Place order",
    ),
  );
  assert.ok(
    q1Calls.some(
      (c) => c.name === "fill" && (c.input as { field: string }).field === "Your name",
    ),
  );
  // The final report must include the bug and reproduction steps.
  const finalText = q1[q1.length - 1].text ?? "";
  assert.match(finalText, /BUG/i);
  assert.match(finalText, /Reproduction steps/i);

  const q2 = buildStuckBrowserScript();
  const q2Calls = q2.flatMap((step) => step.toolCalls ?? []);
  assert.ok(
    !q2Calls.some(
      (c) => c.name === "click" && (c.input as { text: string }).text === "Place order",
    ),
  );
  assert.match(q2[q2.length - 1].text ?? "", /Everything looks fine/i);
});
