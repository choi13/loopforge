import { spawn } from "node:child_process";
import type { ModelProvider, ModelRequest, ModelTurn } from "../provider";
import { buildReactSystemPrompt, reactActionToTurn, renderReactTranscript } from "./react";


/**
 * Provider that drives the locally-installed Claude Code CLI as a raw model —
 * no API key, using whatever account the CLI is logged into.
 *
 * The CLI is normally a full agent with its own tools; here we disable those
 * tools and replace its system prompt with the ReAct format, so `claude -p`
 * behaves as a single-turn model that emits one JSON tool call. Its output is
 * parsed by the same adapter the Ollama provider uses, and the tool call is
 * executed by LoopForge's own loop against the sandbox/game tools.
 *
 * Each turn is one `claude -p` invocation (stateless), so the full conversation
 * is re-rendered as the prompt every time. That means real cost/quota per
 * iteration — this provider is for showcasing a real frontier model locally,
 * not for cheap high-volume runs.
 */

/**
 * Allowing only a single tool name that does not exist disables every real
 * Claude Code tool, so the CLI can't actually run anything and behaves as a
 * pure model that emits our ReAct JSON. (Disabling by name is fragile — the
 * session also carries Artifact/ToolSearch/Workflow/etc.)
 */
const NOOP_ALLOWLIST = "LoopForgeHarnessNoop";

interface CliResult {
  result?: string;
  is_error?: boolean;
  subtype?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class ClaudeCliProvider implements ModelProvider {
  readonly name = "claude-cli";

  constructor(
    readonly model: string = "sonnet",
    private readonly binary: string = "claude",
  ) {}

  async complete(request: ModelRequest): Promise<ModelTurn> {
    const system = buildReactSystemPrompt(request.system, request.tools, {
      planner: true,
    });
    const prompt = renderReactTranscript(request.messages);

    const args = [
      "-p",
      "--model",
      this.model,
      "--system-prompt",
      system,
      "--exclude-dynamic-system-prompt-sections",
      "--allowedTools",
      NOOP_ALLOWLIST,
      "--output-format",
      "json",
    ];

    const { stdout, stderr, code } = await run(this.binary, args, prompt, request.signal);
    if (code !== 0) {
      throw new Error(`claude CLI exited ${code}: ${stderr.slice(0, 500)}`);
    }

    let parsed: CliResult;
    try {
      parsed = JSON.parse(stdout) as CliResult;
    } catch {
      throw new Error(`claude CLI returned non-JSON: ${stdout.slice(0, 300)}`);
    }
    if (parsed.is_error) {
      throw new Error(`claude CLI error (${parsed.subtype ?? "unknown"})`);
    }

    return reactActionToTurn(parsed.result ?? "", {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
    });
  }
}

function run(
  binary: string,
  args: string[],
  stdin: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    // Decode as UTF-8 so multibyte characters split across chunk boundaries
    // are not corrupted (string += Buffer would decode each chunk in isolation).
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    const onAbort = () => child.kill("SIGTERM");

    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("close", (code) => {
      cleanup();
      resolve({ stdout, stderr, code: code ?? 0 });
    });
    // stdin can emit EPIPE if the CLI exits before the prompt is fully written;
    // surface it as a rejection instead of an unhandled stream error.
    child.stdin.on("error", (err) => {
      cleanup();
      reject(err);
    });

    if (signal) {
      if (signal.aborted) child.kill("SIGTERM");
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdin.write(stdin);
    child.stdin.end();
  });
}
