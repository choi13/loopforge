import { promises as fsp, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodingTools, type Tool, type ToolResult } from "@loopforge/core";
import { DEMO_TASK, buildDemoScript, resetDemoSandbox } from "../demo";
import type { PublishState, RunEnvironment } from "./index";

/**
 * The coding environment, wrapped in the plugin interface: four sandboxed
 * tools, the coding system prompt, and the scripted bug-fix demo. The tools,
 * prompt, task, and demo behavior are identical to the pre-plugin harness.
 *
 * Isolation: each run operates on its OWN working copy under os.tmpdir()
 * (loopforge-run-<runId>) so parallel coding runs never stomp each other. The
 * copy is seeded from the demo constants (see resetDemoSandbox) — always the
 * BROKEN calc.js plus the tests — not from the on-disk sandbox, so every
 * coding run starts from the same failing state regardless of what a prior run
 * left behind. The temp dir is removed best-effort when the run finishes.
 *
 * File-diff snapshots: the write_file tool is wrapped so every SUCCESSFUL
 * write publishes an env_state of shape
 * { kind: "coding_files", changes: [{ path, before, after }] } — the
 * cumulative latest snapshot of every file written this run, letting the
 * dashboard render live diffs.
 */

const SYSTEM_PROMPT =
  "You are a coding agent working in a small sandboxed JavaScript project. Use the tools to explore the project, run code, and edit files. The project is plain Node.js with no build step or package manager — run the tests with the command `node test.js` (do NOT use npm/jest). Always verify your changes by running `node test.js` before declaring success; you are done only once it prints that the tests passed. When the task is complete, reply with a brief summary and stop calling tools.";

/** One file's entry in a coding_files snapshot. */
interface FileChange {
  path: string;
  before: string | null;
  after: string;
}

/** Max chars kept per before/after snapshot; longer content is cut. */
const SNAPSHOT_MAX_CHARS = 50_000;

function truncateSnapshot(text: string): string {
  return text.length > SNAPSHOT_MAX_CHARS
    ? `${text.slice(0, SNAPSHOT_MAX_CHARS)}… (truncated)`
    : text;
}

/**
 * Wrap the sandbox write_file tool so every SUCCESSFUL write publishes a
 * cumulative coding_files snapshot: one entry per file ever written this run
 * (in first-write order), with `before` frozen at the content that existed
 * before the FIRST write of the run (null when the file did not exist) and
 * `after` tracking the most recently written content.
 */
function withDiffSnapshots(
  writeFile: Tool,
  sandboxDir: string,
  publishState: PublishState,
): Tool {
  const root = path.resolve(sandboxDir);
  // Keyed by resolved absolute path so "a.js" and "./a.js" share one entry;
  // Map preserves first-write insertion order for the published list.
  const changes = new Map<string, FileChange>();

  return {
    ...writeFile,
    async execute(
      input: { path?: unknown; content?: unknown },
      signal?: AbortSignal,
    ): Promise<ToolResult> {
      const relPath = typeof input?.path === "string" ? input.path : null;
      const content = typeof input?.content === "string" ? input.content : null;

      // Capture the pre-write content BEFORE delegating. Only paths that stay
      // lexically inside the sandbox are read (escapes fail in the real tool
      // anyway, so their result below is an error and nothing is recorded).
      let key: string | null = null;
      let displayPath = "";
      let before: string | null = null;
      if (relPath !== null) {
        const resolved = path.resolve(root, relPath);
        if (resolved === root || resolved.startsWith(root + path.sep)) {
          key = resolved;
          displayPath = relPath;
          if (!changes.has(key)) {
            try {
              before = await fsp.readFile(resolved, "utf8");
            } catch {
              before = null; // Missing (a new file) or unreadable.
            }
          }
        }
      }

      const result = await writeFile.execute(input, signal);
      if (result.isError || key === null || content === null) return result;

      const existing = changes.get(key);
      if (existing) {
        existing.after = truncateSnapshot(content);
      } else {
        changes.set(key, {
          path: displayPath,
          before: before === null ? null : truncateSnapshot(before),
          after: truncateSnapshot(content),
        });
      }
      // Publish copies: snapshots already appended to the run log must stay
      // immutable when a later write advances `after`.
      publishState({
        kind: "coding_files",
        changes: [...changes.values()].map((change) => ({ ...change })),
      });
      return result;
    },
  };
}

export function createCodingEnvironment(
  runId: string,
  publishState: PublishState,
): RunEnvironment {
  const sandboxDir = path.join(os.tmpdir(), `loopforge-run-${runId}`);
  // Seed the fresh per-run copy at creation so both mock and manual runs start
  // from the broken sources in an isolated directory.
  resetDemoSandbox(sandboxDir);

  const tools = createCodingTools(sandboxDir).map((tool) =>
    tool.name === "write_file" ? withDiffSnapshots(tool, sandboxDir, publishState) : tool,
  );

  return {
    tools,
    systemPrompt: SYSTEM_PROMPT,
    demoTask: DEMO_TASK,
    buildDemoScript,
    prepare: () => resetDemoSandbox(sandboxDir),
    cleanup: () => {
      // Best-effort: never let teardown crash a finished run.
      try {
        rmSync(sandboxDir, { recursive: true, force: true });
      } catch {
        // Ignore — the OS will reclaim tmpdir eventually.
      }
    },
  };
}
