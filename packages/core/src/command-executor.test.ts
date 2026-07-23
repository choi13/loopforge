import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDockerRunArgs,
  RestrictedCommandExecutor,
  type CommandExecutor,
} from "./command-executor";

const context = {
  cwd: path.join(os.tmpdir(), "loopforge-executor-test"),
  timeoutMs: 30_000,
  maxBufferBytes: 1024,
};

test("docker executor args enforce the documented isolation baseline", () => {
  const args = buildDockerRunArgs("node test.js", context, {
    user: "1000:1000",
  });
  const joined = args.join(" ");

  assert.match(joined, /--network none/);
  assert.match(joined, /--read-only/);
  assert.match(joined, /--user 1000:1000/);
  assert.match(joined, /--pids-limit 64/);
  assert.match(joined, /--security-opt no-new-privileges/);
  assert.match(joined, /--cap-drop ALL/);
  assert.match(joined, /type=bind,src=.*?,dst=\/workspace/);
  assert.doesNotMatch(joined, /dst=\/workspace,rw/);
  assert.doesNotMatch(joined, /docker\.sock|--env|-e /);
});

test("restricted executor allows a simple allowlisted command", async () => {
  let delegated = "";
  const delegate: CommandExecutor = {
    isolationLevel: "local-process",
    async execute(command) {
      delegated = command;
      return { stdout: "ok", stderr: "", exitCode: 0, timedOut: false };
    },
  };
  const executor = new RestrictedCommandExecutor(delegate, new Set(["node"]));
  const result = await executor.execute("node test.js", context);

  assert.equal(result.exitCode, 0);
  assert.equal(delegated, "node test.js");
});

test("restricted executor rejects chaining and non-allowlisted commands", async () => {
  const executor = new RestrictedCommandExecutor();

  assert.equal((await executor.execute("node test.js; env", context)).exitCode, 126);
  assert.equal((await executor.execute("curl example.com", context)).exitCode, 126);
});
