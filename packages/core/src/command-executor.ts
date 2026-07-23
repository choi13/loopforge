import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export type IsolationLevel = "local-process" | "restricted-command" | "docker";

export interface CommandExecutionContext {
  cwd: string;
  timeoutMs: number;
  maxBufferBytes: number;
  signal?: AbortSignal;
}

export interface CommandExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface CommandExecutor {
  readonly isolationLevel: IsolationLevel;
  execute(
    command: string,
    context: CommandExecutionContext,
  ): Promise<CommandExecutionResult>;
}

interface ProcessFailure {
  stdout?: string;
  stderr?: string;
  code?: number | string;
  killed?: boolean;
  signal?: string;
}

function failureResult(error: unknown): CommandExecutionResult {
  const failure = error as ProcessFailure;
  return {
    stdout: failure.stdout ?? "",
    stderr: failure.stderr ?? "",
    exitCode: typeof failure.code === "number" ? failure.code : 1,
    timedOut: failure.killed === true || failure.signal === "SIGTERM",
  };
}

export class LocalProcessExecutor implements CommandExecutor {
  readonly isolationLevel = "local-process" as const;

  async execute(
    command: string,
    context: CommandExecutionContext,
  ): Promise<CommandExecutionResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: context.cwd,
        timeout: context.timeoutMs,
        maxBuffer: context.maxBufferBytes,
        signal: context.signal,
      });
      return { stdout, stderr, exitCode: 0, timedOut: false };
    } catch (error) {
      return failureResult(error);
    }
  }
}

/**
 * Local convenience mode for trusted tasks that need only a small command
 * allowlist. Shell operators are rejected rather than parsed ambiguously.
 * This is defense-in-depth, not an OS sandbox.
 */
export class RestrictedCommandExecutor implements CommandExecutor {
  readonly isolationLevel = "restricted-command" as const;

  constructor(
    private readonly delegate: CommandExecutor = new LocalProcessExecutor(),
    private readonly allowedCommands: ReadonlySet<string> = new Set([
      "node",
      "npm",
      "npx",
    ]),
  ) {}

  execute(
    command: string,
    context: CommandExecutionContext,
  ): Promise<CommandExecutionResult> {
    if (/[\n\r;&|><`$()]/.test(command)) {
      return Promise.resolve({
        stdout: "",
        stderr: "Command rejected: shell operators are not allowed",
        exitCode: 126,
        timedOut: false,
      });
    }
    const executable = command.trim().split(/\s+/, 1)[0] ?? "";
    if (!this.allowedCommands.has(executable)) {
      return Promise.resolve({
        stdout: "",
        stderr: `Command rejected: ${executable || "(empty)"} is not allowlisted`,
        exitCode: 126,
        timedOut: false,
      });
    }
    return this.delegate.execute(command, context);
  }
}

export interface DockerExecutorOptions {
  image?: string;
  cpus?: number;
  memoryMb?: number;
  pidsLimit?: number;
  user?: string;
}

export function buildDockerRunArgs(
  command: string,
  context: CommandExecutionContext,
  options: DockerExecutorOptions = {},
): string[] {
  const image = options.image ?? "node:22-alpine";
  const cpus = options.cpus ?? 0.5;
  const memoryMb = options.memoryMb ?? 512;
  const pidsLimit = options.pidsLimit ?? 64;
  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  const user =
    options.user ??
    (hostUid !== undefined && hostUid > 0
      ? `${hostUid}:${hostGid ?? hostUid}`
      : "65534:65534");

  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--user",
    user,
    "--cpus",
    String(cpus),
    "--memory",
    `${memoryMb}m`,
    "--pids-limit",
    String(pidsLimit),
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--mount",
    `type=bind,src=${context.cwd},dst=/workspace`,
    "--workdir",
    "/workspace",
    image,
    "sh",
    "-lc",
    command,
  ];
}

/**
 * Optional stronger boundary for trusted local operators. It never mounts the
 * Docker socket, host secrets, or host environment variables.
 */
export class DockerCommandExecutor implements CommandExecutor {
  readonly isolationLevel = "docker" as const;

  constructor(private readonly options: DockerExecutorOptions = {}) {}

  async execute(
    command: string,
    context: CommandExecutionContext,
  ): Promise<CommandExecutionResult> {
    try {
      const { stdout, stderr } = await execFileAsync(
        "docker",
        buildDockerRunArgs(command, context, this.options),
        {
          timeout: context.timeoutMs,
          maxBuffer: context.maxBufferBytes,
          signal: context.signal,
        },
      );
      return { stdout, stderr, exitCode: 0, timedOut: false };
    } catch (error) {
      return failureResult(error);
    }
  }
}
