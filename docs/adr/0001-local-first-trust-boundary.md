# ADR 0001: Local-first trust boundary

- Status: Accepted
- Date: 2026-07-23

## Decision

LoopForge is a **local-first AI agent observability and evaluation workbench**.
It is not a multi-tenant agent execution SaaS.

## Trust model

- The operator is the local user or a trusted development-team member.
- Tasks, prompts, workspaces, and provider configuration come only from trusted users.
- Anonymous/public task submission is unsupported.
- The API and QA target bind explicitly to `127.0.0.1`; REST and WebSocket
  requests enforce loopback Host and browser-origin checks. An unauthenticated
  public deployment is prohibited.

## Execution model

- Every coding run gets its own temporary workspace.
- File tools enforce lexical and realpath/symlink confinement.
- The default `LocalProcessExecutor` has a timeout and output limit but is **not**
  syscall, process, or network isolation.
- `RestrictedCommandExecutor` is optional defense-in-depth for simple trusted tasks.
- `DockerCommandExecutor` is the stronger option for external task material. It
  disables network, runs non-root, uses a read-only root filesystem, drops
  capabilities, forbids privilege escalation, and limits CPU, memory, PIDs,
  time, and output. Only the run workspace is writable.
- No executor mounts the Docker socket, host secrets, or arbitrary host environment.

The UI or operator documentation must state the selected isolation level. Docker
availability does not turn LoopForge into a safe public service by itself.

## Trace and data model

Traces may contain prompts, model output, tool input/output, file excerpts, and
local paths. Before persistence or WebSocket broadcast, LoopForge redacts
sensitive key names, common token formats, authorization headers, home-directory
usernames, and oversized strings.

Operators must still avoid entering secrets or personal data. Raw provider
responses are not a durable public artifact.

## Supported use

- local development and debugging
- deterministic or controlled model evaluation
- internal demonstrations and portfolio evidence
- mock-only public screenshots or prerecorded traces

Unsupported:

- anonymous Internet access
- untrusted code execution as a service
- multi-tenant secret handling
- claims of full container/syscall isolation

## Consequences

Features that imply public task ingestion, shared tenancy, authentication-free
remote shell access, or hidden host access are rejected until a separate ADR
defines a production-grade security architecture and independent review.
