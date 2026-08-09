import assert from "node:assert/strict";
import { test } from "node:test";
import { OllamaProvider } from "./ollama";

test("OllamaProvider defaults to qwen3:14b", () => {
  assert.equal(new OllamaProvider().model, "qwen3:14b");
});
