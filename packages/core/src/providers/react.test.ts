import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReactSystemPrompt,
  parseReactAction,
  reactActionToTurn,
  renderReactTranscript,
} from "./react";
import type { ToolDefinition } from "../tools";

const usage = { inputTokens: 1, outputTokens: 1 };

test("parses a bare JSON action", () => {
  const a = parseReactAction('{"tool":"list_files","input":{}}');
  assert.equal(a?.tool, "list_files");
  assert.deepEqual(a?.input, {});
});

test("parses JSON wrapped in a ```json fence", () => {
  const a = parseReactAction('```json\n{"tool":"read_file","input":{"path":"a.js"}}\n```');
  assert.equal(a?.tool, "read_file");
  assert.deepEqual(a?.input, { path: "a.js" });
});

test("captures leading prose as the thought", () => {
  const a = parseReactAction('Let me look.\n{"tool":"list_files","input":{}}');
  assert.equal(a?.tool, "list_files");
  assert.match(a?.thought ?? "", /Let me look/);
});

test("REGRESSION: code fences INSIDE a JSON string value are preserved", () => {
  // The bug: stripping ``` over the whole output corrupted write_file content.
  const content = "# Title\n```js\nconst x = 1;\n```\n";
  const raw = JSON.stringify({ tool: "write_file", input: { path: "R.md", content } });
  const a = parseReactAction(raw);
  assert.equal(a?.tool, "write_file");
  assert.equal(a?.input.content, content, "content must round-trip byte-for-byte");
});

test("ignores braces inside string values when scanning", () => {
  const a = parseReactAction('{"tool":"write_file","input":{"path":"x","content":"a { b } c"}}');
  assert.equal(a?.input.content, "a { b } c");
});

test("no valid action -> null", () => {
  assert.equal(parseReactAction("I cannot help with that."), null);
});

test("reactActionToTurn: tool action becomes a tool call", () => {
  const turn = reactActionToTurn('{"tool":"list_files","input":{}}', usage);
  assert.equal(turn.toolCalls.length, 1);
  assert.equal(turn.toolCalls[0].name, "list_files");
});

test("reactActionToTurn: final action ends the run with the answer text", () => {
  const turn = reactActionToTurn('{"tool":"final","input":{"answer":"done"}}', usage);
  assert.equal(turn.toolCalls.length, 0);
  assert.equal(turn.text, "done");
});

test("reactActionToTurn: plain prose (no action) ends the run", () => {
  const turn = reactActionToTurn("All finished, nothing else to do.", usage);
  assert.equal(turn.toolCalls.length, 0);
  assert.match(turn.text ?? "", /All finished/);
});

test("buildReactSystemPrompt lists tools; planner mode adds the no-tools framing", () => {
  const tools: ToolDefinition[] = [
    { name: "list_files", description: "list", inputSchema: { type: "object", properties: {} } },
  ];
  const plain = buildReactSystemPrompt("BASE", tools);
  assert.match(plain, /list_files/);
  const planner = buildReactSystemPrompt("BASE", tools, { planner: true });
  assert.match(planner, /do NOT have tools/i);
});

test("renderReactTranscript renders observations and prompts for the next action", () => {
  const out = renderReactTranscript([
    { role: "user", content: [{ type: "text", text: "task" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "1", name: "list_files", input: {} }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "1", content: "a.js" }] },
  ]);
  assert.match(out, /Observation/);
  assert.match(out, /next action/i);
});
