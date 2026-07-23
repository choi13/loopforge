import { promises as fs } from "node:fs";
import path from "node:path";
import {
  LocalProcessExecutor,
  type CommandExecutor,
} from "./command-executor";
import type { Tool, ToolResult } from "./tools";

const MAX_OUTPUT_CHARS = 10_000;
const MAX_FILE_CHARS = 50_000;
const MAX_LISTED_FILES = 200;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

function truncate(text: string, limit: number): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n… (truncated, ${text.length} chars total)`
    : text;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The coding environment: four tools rooted in a sandbox directory. Paths are
 * resolved and confined to the sandbox; commands run with a timeout.
 */
export interface CodingToolOptions {
  commandExecutor?: CommandExecutor;
}

export function createCodingTools(
  sandboxRoot: string,
  options: CodingToolOptions = {},
): Tool[] {
  const root = path.resolve(sandboxRoot);
  const commandExecutor = options.commandExecutor ?? new LocalProcessExecutor();
  let realRootCache: string | null = null;

  async function realRootPath(): Promise<string> {
    if (realRootCache === null) realRootCache = await fs.realpath(root);
    return realRootCache;
  }

  async function resolveInside(relativePath: string): Promise<string> {
    const resolved = path.resolve(root, relativePath);
    // Fast lexical reject.
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Path escapes the sandbox: ${relativePath}`);
    }
    // Defense in depth: resolve symlinks on the nearest existing ancestor and
    // re-check against the REAL sandbox root, so a symlink inside the sandbox
    // can't point outside it. (realpath both sides — os.tmpdir() itself is a
    // symlink on macOS, e.g. /var -> /private/var.)
    const realRoot = await realRootPath();
    let probe = resolved;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
          throw new Error(`Path escapes the sandbox (symlink): ${relativePath}`);
        }
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          const parent = path.dirname(probe);
          if (parent === probe) break; // reached filesystem root
          probe = parent;
          continue;
        }
        throw err;
      }
    }
    return resolved;
  }

  const readFile: Tool = {
    name: "read_file",
    description:
      "Read a file from the project. Returns the full file content as text.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
      },
      required: ["path"],
    },
    async execute(input: { path: string }): Promise<ToolResult> {
      try {
        const content = await fs.readFile(await resolveInside(input.path), "utf8");
        return { output: truncate(content, MAX_FILE_CHARS) };
      } catch (error) {
        return { output: `read_file failed: ${describe(error)}`, isError: true };
      }
    },
  };

  const writeFile: Tool = {
    name: "write_file",
    description:
      "Write a file in the project, creating it (and parent directories) if needed. Overwrites existing content.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
        content: { type: "string", description: "Full new file content" },
      },
      required: ["path", "content"],
    },
    async execute(input: { path: string; content: string }): Promise<ToolResult> {
      try {
        const target = await resolveInside(input.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, input.content, "utf8");
        return { output: `Wrote ${Buffer.byteLength(input.content)} bytes to ${input.path}` };
      } catch (error) {
        return { output: `write_file failed: ${describe(error)}`, isError: true };
      }
    },
  };

  const listFiles: Tool = {
    name: "list_files",
    description:
      "List files in the project recursively. Optionally pass a subdirectory path.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory relative to the project root (default: the root)",
        },
      },
    },
    async execute(input: { path?: string }): Promise<ToolResult> {
      try {
        const start = await resolveInside(input.path ?? ".");
        const found: string[] = [];
        await walk(start, found);
        if (found.length === 0) return { output: "(no files)" };
        let out = found.map((f) => path.relative(root, f)).sort().join("\n");
        if (found.length >= MAX_LISTED_FILES) {
          out += `\n… (listing truncated at ${MAX_LISTED_FILES} files)`;
        }
        return { output: out };
      } catch (error) {
        return { output: `list_files failed: ${describe(error)}`, isError: true };
      }
    },
  };

  async function walk(dir: string, found: string[]): Promise<void> {
    if (found.length >= MAX_LISTED_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (found.length >= MAX_LISTED_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full, found);
      } else {
        found.push(full);
      }
    }
  }

  const runCommand: Tool = {
    name: "run_command",
    description:
      "Run a shell command in the project root (30s timeout). Returns stdout, stderr, and the exit code.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
    async execute(input: { command: string }, signal?: AbortSignal): Promise<ToolResult> {
      const result = await commandExecutor.execute(input.command, {
        cwd: root,
        timeoutMs: 30_000,
        maxBufferBytes: 1024 * 1024,
        signal,
      });
      const body = formatCommandOutput(
        result.stdout,
        result.stderr,
        result.exitCode,
      );
      const note = result.timedOut ? "\n(command timed out after 30s)" : "";
      return {
        output: truncate(body + note, MAX_OUTPUT_CHARS),
        isError: result.exitCode !== 0,
      };
    },
  };

  return [readFile, writeFile, listFiles, runCommand];
}

function formatCommandOutput(stdout: string, stderr: string, exitCode: number): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(stdout.trimEnd());
  if (stderr.trim()) parts.push(`[stderr]\n${stderr.trimEnd()}`);
  parts.push(`[exit code: ${exitCode}]`);
  return parts.join("\n");
}
