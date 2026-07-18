import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createCodingTools } from "./coding-tools";
import type { Tool } from "./tools";

let root: string;
let tools: Record<string, Tool>;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "lf-tools-test-"));
  tools = Object.fromEntries(createCodingTools(root).map((t) => [t.name, t]));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("write_file then read_file round-trips", async () => {
  await tools.write_file.execute({ path: "a.txt", content: "hello" });
  const r = await tools.read_file.execute({ path: "a.txt" });
  assert.equal(r.isError ?? false, false);
  assert.equal(r.output, "hello");
});

test("write_file preserves content containing code fences verbatim", async () => {
  const content = "# T\n```js\nx\n```\n";
  await tools.write_file.execute({ path: "R.md", content });
  const onDisk = await fs.readFile(path.join(root, "R.md"), "utf8");
  assert.equal(onDisk, content);
});

test("read_file rejects a lexical path escape (..)", async () => {
  const r = await tools.read_file.execute({ path: "../escape.txt" });
  assert.equal(r.isError, true);
  assert.match(r.output, /escapes the sandbox/i);
});

test("REGRESSION: a symlink pointing outside the sandbox is rejected", async () => {
  // Create a symlink inside the sandbox that targets /etc, then try to read
  // through it. Lexical confinement alone would allow this; the realpath check
  // must block it.
  await fs.symlink("/etc", path.join(root, "link"));
  const r = await tools.read_file.execute({ path: "link/hosts" });
  assert.equal(r.isError, true, "reading through an escaping symlink must fail");
  assert.match(r.output, /escapes the sandbox|read_file failed/i);
});

test("list_files finds written files", async () => {
  await tools.write_file.execute({ path: "sub/b.txt", content: "x" });
  const r = await tools.list_files.execute({});
  assert.match(r.output, /a\.txt/);
  assert.match(r.output, /sub\/b\.txt/);
});

test("run_command returns stdout and exit code", async () => {
  const r = await tools.run_command.execute({ command: "echo hi" });
  assert.match(r.output, /hi/);
  assert.match(r.output, /exit code: 0/);
});
