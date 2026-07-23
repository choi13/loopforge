import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configuredBrowserOrigins,
  getCommandExecutorMode,
  isAllowedBrowserOrigin,
  isAllowedLoopbackHost,
  isolationLevelForMode,
} from "./local-boundary";

test("only loopback Host headers pass the local-first boundary", () => {
  for (const host of [
    "localhost",
    "localhost:8787",
    "127.0.0.1",
    "127.0.0.1:8787",
    "[::1]:8787",
  ]) {
    assert.equal(isAllowedLoopbackHost(host), true, host);
  }
  for (const host of [undefined, "loopforge.example", "127.0.0.1.example:8787"]) {
    assert.equal(isAllowedLoopbackHost(host), false, String(host));
  }
});

test("browser origins are allowlisted while CLI requests remain supported", () => {
  const origins = configuredBrowserOrigins("http://localhost:9000");
  assert.equal(isAllowedBrowserOrigin(undefined, origins), true);
  assert.equal(isAllowedBrowserOrigin("http://localhost:5173", origins), true);
  assert.equal(isAllowedBrowserOrigin("http://localhost:9000", origins), true);
  assert.equal(isAllowedBrowserOrigin("https://attacker.example", origins), false);
});

test("executor configuration fails closed and exposes its isolation level", () => {
  assert.equal(getCommandExecutorMode(undefined), "local");
  assert.equal(isolationLevelForMode("local"), "local-process");
  assert.equal(isolationLevelForMode("restricted"), "restricted-command");
  assert.equal(isolationLevelForMode("docker"), "docker");
  assert.throws(() => getCommandExecutorMode("unknown"), /Unsupported/);
});
