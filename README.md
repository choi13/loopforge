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

### Providers

LoopForge runs the same agent loop against three interchangeable providers:

- **Mock** — scripted, deterministic; its tool calls execute for real. No setup.
- **Local (Ollama)** — a real model, no API key, no cost. Install [Ollama](https://ollama.com), `ollama pull llama3`, and pick **Local (Ollama · llama3)** in the dashboard. Because these local models don't support native tool-calling, `OllamaProvider` uses a **ReAct-style JSON adapter** so any completion model can drive the loop.
- **Claude CLI (local account)** — drives the locally-installed Claude Code CLI (`claude -p`) as a model backend, using whatever account the CLI is logged into — **a real frontier model with no separate API key**. `ClaudeCliProvider` disables the CLI's own tools and hands it the same ReAct planner prompt, so `claude -p` acts as a single-turn model whose JSON action LoopForge's loop executes against the sandbox/game tools. Each iteration is one `claude -p` call, so this uses real account quota — it's for showcasing a frontier model locally, not cheap high-volume runs.
- **Anthropic** — the Claude API directly. Copy `.env.example` to `.env` (gitignored) and set `ANTHROPIC_API_KEY=sk-ant-...`; the server auto-loads it. Then pick the **anthropic** provider (defaults to `claude-opus-4-8`).

All four providers share one agent loop; the two local ones (Ollama, Claude CLI) share the `providers/react.ts` adapter.

Every provider works in both the Runs view and the Eval harness. Running the demo suite under a real local model produces an honest capability profile — e.g. llama3 reliably solves the coding bug-fix but not Sokoban, so the eval lands at 50%.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Core loop engine + live trace dashboard + coding tools + mock mode | ✅ |
| 2 | Game-arena environment via pluggable environments (agent solves Sokoban on a live board) | ✅ |
| 3 | Eval harness (task suites, parallel scored runs, pass-rate aggregation, leaderboard, per-run sandbox isolation) | ✅ |
| 4 | Autonomous QA agent environment (Playwright) | ⏳ |
| 5 | Richer coding environment (multi-file tasks, diff view) | ⏳ |

### What each phase demonstrates

- **Phase 1** — the agent loop is a first-class, fully observable object: every model turn, thinking block, tool call, and result streams to the dashboard as it happens.
- **Phase 2** — the harness is *pluggable*. A whole new domain (a Sokoban game with a live animated board) was added as an environment plugin without touching the core loop — the loop just publishes `env_state` snapshots the UI renders.
- **Phase 3** — the harness *measures*. It runs a task suite as a batch of scored runs (concurrency-capped, each in an isolated sandbox), and aggregates pass-rate and cost. The demo suite is deliberately **2 pass / 2 fail** so the scorer visibly distinguishes a genuine solution from a lazy or stuck agent. Click any result to drill into that run's full trace.

## Safety note

`run_command` executes shell commands inside `sandbox/` with a 30s timeout, and file tools are path-confined to the sandbox. This is a local development tool — runs only start when you start them.
