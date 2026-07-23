export const LOCAL_BIND_HOST = "127.0.0.1";

export type CommandExecutorMode = "local" | "restricted" | "docker";
export type PublicIsolationLevel =
  | "local-process"
  | "restricted-command"
  | "docker";

const DEFAULT_BROWSER_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

export function getCommandExecutorMode(
  value = process.env.LOOPFORGE_COMMAND_EXECUTOR,
): CommandExecutorMode {
  const mode = value ?? "local";
  if (mode === "local" || mode === "restricted" || mode === "docker") {
    return mode;
  }
  throw new Error(
    `Unsupported LOOPFORGE_COMMAND_EXECUTOR=${mode}; use local, restricted, or docker`,
  );
}

export function isolationLevelForMode(
  mode: CommandExecutorMode,
): PublicIsolationLevel {
  if (mode === "restricted") return "restricted-command";
  if (mode === "docker") return "docker";
  return "local-process";
}

export function configuredBrowserOrigins(
  extraOrigins = process.env.LOOPFORGE_ALLOWED_WEB_ORIGINS,
): ReadonlySet<string> {
  const extras = (extraOrigins ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_BROWSER_ORIGINS, ...extras]);
}

/** Reject non-loopback Host headers to mitigate DNS rebinding. */
export function isAllowedLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return (
    /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(normalized) ||
    /^\[::1\](?::\d+)?$/.test(normalized)
  );
}

/** Browser requests must come from the local UI. CLI requests have no Origin. */
export function isAllowedBrowserOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}
