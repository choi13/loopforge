# LoopForge

**An agent-loop engineering platform.** Build LLM agent loops, watch every iteration stream live on a trace dashboard, and (in later phases) benchmark them across environments — coding tasks, games, evals, and browser QA.

> The agent loop — *observe → reason → act → verify* — is the heart of every modern AI agent. LoopForge makes that loop a first-class, observable object instead of a black box.

## Architecture

```
loopforge/
├── packages/core      Agent-loop engine: loop, providers, tools, trace events
├── packages/server    Run orchestration: REST + WebSocket streaming of trace events
├── packages/web       Live trace dashboard (React + Vite)
└── sandbox/           Sandboxed project the coding agent operates on
```

- **`@loopforge/core`** — a provider-agnostic agent loop (`AgentLoop`) that emits a `TraceEvent` for every step: iteration start, model request/response (including thinking), tool call, tool result, run finish. Providers: `AnthropicProvider` (Claude API, adaptive thinking) and `MockProvider` (scripted — but its tool calls execute for real, so demos genuinely run without an API key).
- **`@loopforge/server`** — creates and manages runs, records the event log, and broadcasts every event over WebSocket.
- **`@loopforge/web`** — renders the loop live: per-iteration cards with the model's thinking, tool inputs/outputs, token usage, and run status.

## Quickstart

```bash
npm install

# Terminal 1 — API + WebSocket server (port 8787)
npm run dev:server

# Terminal 2 — dashboard (port 5173)
npm run dev:web
```

Open http://localhost:5173 and start a **mock** run — no API key needed. The scripted agent finds and fixes a real bug in `sandbox/demo-project` (its tool calls actually execute: it reads files, runs the failing test, patches the code, and re-runs the test green).

To run against the real Claude API:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

then choose the **anthropic** provider in the dashboard and give it any task for the sandbox project.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Core loop engine + live trace dashboard + coding tools + mock mode | ✅ |
| 2 | Richer coding environment (multi-file tasks, diff view) | ⏳ |
| 3 | Game arena environment (agent plays 2048/Sokoban with visible reasoning) | ⏳ |
| 4 | Eval harness (task suites, parallel runs, model/prompt leaderboards) | ⏳ |
| 5 | Autonomous QA agent environment (Playwright) | ⏳ |

## Safety note

`run_command` executes shell commands inside `sandbox/` with a 30s timeout, and file tools are path-confined to the sandbox. This is a local development tool — runs only start when you start them.
