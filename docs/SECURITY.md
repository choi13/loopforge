# Security and isolation

## Command executor modes

Set `LOOPFORGE_COMMAND_EXECUTOR` before starting the server:

| Value | Boundary | Intended use |
|---|---|---|
| `local` (default) | temp-directory path confinement, 30s timeout, output limit | trusted local demo/development |
| `restricted` | local boundary plus `node`/`npm`/`npx` allowlist and shell-operator rejection | simple trusted coding tasks |
| `docker` | non-root container, no network, read-only root, dropped capabilities, resource limits | stronger isolation for externally sourced task material |

Docker mode requires a locally installed Docker engine and the `node:22-alpine`
image. It deliberately does not mount `/var/run/docker.sock`, secrets, or host
environment variables. The per-run workspace is the only writable bind mount.

These modes do not authorize exposing the server publicly. Docker is a stronger
execution boundary, not an authentication or multi-tenancy system.

The API and seeded QA target bind to `127.0.0.1`. REST requests reject
non-loopback Host headers and unapproved browser origins; WebSocket upgrades
apply the same checks. This reduces LAN exposure, cross-site local requests,
and DNS-rebinding risk. The dashboard displays the active executor isolation
level from `/api/health`.

## Trace redaction

`RunManager` redacts an event before adding it to the run log or broadcasting it.
The pipeline covers:

- keys containing token, secret, password, API key, authorization, or cookie
- Bearer tokens, common OpenAI/Anthropic/GitHub/AWS key formats
- environment-style secret assignments
- usernames in `/Users/<name>` and `/home/<name>` paths
- strings above 20,000 characters
- circular data

Redaction is defense-in-depth. Do not put credentials, production data, private
source files, or personal information in tasks. New provider/tool integrations
must add regression fixtures for any additional credential format they can emit.

## Failure taxonomy

Terminal traces may include a stable `failureCode`, including timeout, provider
unavailability, invalid model output, maximum iterations, environment errors,
policy violations, test regressions, and wrong solutions. UI and evaluation
aggregation should group platform failures separately from model failures.

## Public demo rule

A public demo must be mock-only or replay a sanitized stored bundle. It must not
expose `run_command`, accept arbitrary tasks, or connect to live provider secrets.
