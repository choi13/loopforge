import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolResult } from "./tools";

const execAsync = promisify(exec);

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
export function createCodingTools(sandboxRoot: string): Tool[] {
  const root = path.resolve(sandboxRoot);

  function resolveInside(relativePath: string): string {
    const resolved = path.resolve(root, relativePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Path escapes the sandbox: ${relativePath}`);
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
        const content = await fs.readFile(resolveInside(input.path), "utf8");
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
        const target = resolveInside(input.path);
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
        const start = resolveInside(input.path ?? ".");
        const found: string[] = [];
        await walk(start, found);
        if (found.length === 0) return { output: "(no files)" };
        return { output: found.map((f) => path.relative(root, f)).sort().join("\n") };
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
    async execute(input: { command: string }): Promise<ToolResult> {
      try {
        const { stdout, stderr } = await execAsync(input.command, {
          cwd: root,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
        return { output: truncate(formatCommandOutput(stdout, stderr, 0), MAX_OUTPUT_CHARS) };
      } catch (error) {
        const failure = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          killed?: boolean;
          message?: string;
        };
        const exitCode = typeof failure.code === "number" ? failure.code : 1;
        const body = formatCommandOutput(failure.stdout ?? "", failure.stderr ?? "", exitCode);
        const note = failure.killed ? "\n(command timed out after 30s)" : "";
        return { output: truncate(body + note, MAX_OUTPUT_CHARS), isError: true };
      }
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
