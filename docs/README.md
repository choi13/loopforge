# LoopForge Documentation

> The full documentation set for LoopForge — an agent-loop engineering, observability, and evaluation platform. Ground truth throughout is the code; every command, path, type, and behavior is pulled from source.

New here? Read in order — each doc builds on the one before it.

| # | Doc | What it covers |
|---|---|---|
| 1 | **[Architecture](ARCHITECTURE.md)** | The system design: the agent loop as an observable object, the monorepo layering, the `TraceEvent` model that ties everything together, end-to-end run and eval data flow, and the abstraction seams that make it extensible. |
| 2 | **[Providers](PROVIDERS.md)** | The `ModelProvider` seam and the four interchangeable backends — `mock`, `ollama`, `claude-cli`, `anthropic` — plus the per-provider model override and the shared ReAct adapter that lets tool-less models drive the loop. |
| 3 | **[Environments](ENVIRONMENTS.md)** | The `RunEnvironment` seam: the tool contract, the sandboxed `coding` environment (with live file-diff snapshots), the `sokoban` game arena, the `browser` web-QA arena (Playwright vs the seeded LoopMart shop), and how live state reaches the dashboard as `env_state`. |
| 4 | **[Eval Harness](EVAL_HARNESS.md)** | Running a whole task suite as real scored runs: the two shipped suites (`demo`, `web-qa`), the deterministic event-based scorer (and its anti-cheat), the concurrency-capped `EvalManager` pipeline, and the live leaderboard keyed by (provider, model). |
| 5 | **[Development](DEVELOPMENT.md)** | Building, running, and testing LoopForge locally; per-provider prerequisites; the test suites and what they verify; the quality bar; and the roadmap. |
| — | **[Design notes & interview prep](INTERVIEW.md)** | The design decisions defended as interview Q&A — the single most important choice, the provider-boundary trade-off, how tool-less models are driven, why scoring is deterministic, and the self-audit. |

## Quick links by task

- **Understand the design** → [Architecture](ARCHITECTURE.md)
- **Run a real model with no API key** → [Providers § `claude-cli`](PROVIDERS.md) / [§ `ollama`](PROVIDERS.md)
- **Add a new model backend** → [Providers § How to add a new provider](PROVIDERS.md)
- **Add a new world for the agent** → [Environments § How to add an environment](ENVIRONMENTS.md)
- **Measure pass rates across providers and models** → [Eval Harness](EVAL_HARNESS.md)
- **Get it running locally** → [Development](DEVELOPMENT.md)

## See also

- The project **[README](../README.md)** — the landing page: pitch, feature highlights, architecture diagram, provider comparison, and quickstart.
