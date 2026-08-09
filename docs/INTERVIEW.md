# Interview Prep — LoopForge

> Mock questions an interviewer is likely to ask about this project, with answer angles grounded in the actual code. Use these to rehearse; the goal is to be able to defend every design decision.

Repo: <https://github.com/choi13/loopforge> · Stack: TypeScript, npm workspaces, React + Vite, Express + WebSocket, Playwright, `node:test`.

---

## The 30-second pitch

> LoopForge turns the agent loop — the *observe → reason → act → verify* cycle at the heart of every LLM agent — into a first-class, observable object instead of a black box. The loop emits a typed `TraceEvent` for every meaningful moment, and everything else (the server, the live dashboard, the eval scorer) is just a consumer of that one event stream. The same loop runs interchangeably against four model providers and three pluggable environments, and a deterministic eval harness scores whole task suites and ranks providers — down to the specific model — on a live leaderboard.

---

## 1. What's the single most important design decision here?

**Answer:** Making the agent loop emit one typed event stream (`TraceEvent`) and building everything else as a consumer of it. The loop in [`packages/core/src/loop.ts`](../packages/core/src/loop.ts) doesn't know about WebSockets, React, or scoring — it just calls `onEvent(...)` for each step. The server records + broadcasts those events; the dashboard folds them into UI; the scorer reads them to judge pass/fail. That inversion is why adding a game board or a browser screenshot panel never touched the loop: environment state is just another `env_state` event.

**Follow-up "why is that better than X":** Most agent frameworks expose only the final answer. If you want observability you bolt on logging after the fact, and it drifts from reality. Here the trace *is* the source of truth — the same events drive the live UI and the deterministic scorer, so what you see is exactly what's scored.

---

## 2. Walk me through the provider abstraction. Why is `complete()` a single turn?

**Answer:** [`ModelProvider.complete(request) → ModelTurn`](../packages/core/src/provider.ts) produces exactly one assistant turn (text and/or `tool_use`). The **loop** owns the conversation history and executes the tools; the provider only translates "conversation + tool schemas" into one completion. I deliberately did *not* make the provider a whole agent.

**Why:** If each provider were a full agent, every provider would re-implement tool execution, safety, and tracing. By cutting the boundary at "one turn," tool execution lives in one place ([`loop.ts`](../packages/core/src/loop.ts)), so mock, local Ollama, the Claude CLI, and the Claude API all run against the *identical* sandbox tools and get scored identically. That's what makes the eval fair across backends.

**Trade-off I can name:** The cost is that the provider can't do provider-specific multi-step optimizations (e.g. the Claude API's own agent loop). For this project that's the right trade — fairness and a uniform trace matter more than squeezing a provider's native loop.

---

## 3. Two of your providers are real models with no API key. How?

**Answer:** Two tricks, both in the providers folder.

- **Ollama** ([`providers/ollama.ts`](../packages/core/src/providers/ollama.ts)): the provider deliberately uses a **ReAct adapter** ([`providers/react.ts`](../packages/core/src/providers/react.ts)) instead of native tool-calling: the system prompt lists the tools and asks the model to emit one tool call as a JSON object; a balanced-brace parser extracts it back into a `ModelTurn`. Any completion model becomes loop-drivable.
- **Claude CLI** ([`providers/claude-cli.ts`](../packages/core/src/providers/claude-cli.ts)): I wrap the locally logged-in `claude -p` as a raw single-turn model — disable its built-in tools (`--allowedTools` with one non-existent name), replace its system prompt with the ReAct format, and parse the JSON out of stdout. It runs on the user's existing Claude session, no API key.

**The story that shows depth:** With the CLI, Claude (being alignment-trained) resisted robotically "output only JSON" and, when it noticed the tools it was told about didn't actually exist in its session, it broke format to *flag the inconsistency* rather than play along. I fixed it by reframing the prompt as "you are the planner; an external harness executes your JSON" and fully disabling its tools. That's a concrete example of observing real model behavior and responding with prompt engineering.

---

## 4. How would you add a fourth environment?

**Answer:** Implement the [`RunEnvironment`](../packages/server/src/environments/index.ts) interface (`tools`, `systemPrompt`, `demoTask`, optional `buildDemoScript`/`prepare`/`cleanup`/`onRunStart`, and a `publishState` callback for live state), register it in the environment factory, and add a scorer branch. The loop and providers don't change.

**Proof it works:** Phase 2 (Sokoban) and Phase 5 (the Playwright web-QA browser) each plugged in with **zero changes to `packages/core`** except adding one event variant. The browser environment ([`environments/browser.ts`](../packages/server/src/environments/browser.ts)) drives headless Chromium with `goto/read_page/click/fill`, publishes screenshots as `env_state`, and is origin-allowlisted to the seeded demo shop only.

---

## 5. How does scoring work, and why deterministic?

**Answer:** [`eval/scorer.ts`](../packages/server/src/eval/scorer.ts) `scoreRun` reads only the finished run's `TraceEvent[]` — no re-running the sandbox, no LLM judge. Coding passes iff a `run_command` that actually executed the tests printed the pass marker; sokoban passes iff an `env_state` reports `solved`; browser passes iff a successful `click` surfaced the planted 500.

**Why deterministic:** The whole point of the harness is to prove it can tell success from failure. An LLM judge is non-deterministic and self-biased, which undermines that claim.

**The detail that impresses:** My first coding scorer checked whether any `run_command` output *contained* `"All tests passed"` — but that string is also in the test file's source, so `cat test.js` would false-pass. I caught this in an audit and now **correlate the command**: only a run that actually executed `node test.js` counts. Finding and closing a gaming vector in your own scorer is exactly the maturity a harness needs.

---

## 6. What did you do for quality/testing?

**Answer:** After building the features, I ran an **adversarial audit pass**: parallel reviewers over core/server/web plus a runtime verifier, then adversarially re-verified each finding ("does this actually fail, with what inputs?"). That surfaced **11 confirmed bugs**, all fixed and locked with regression tests. The suite is now **53 `node:test` tests** run in CI on every push.

**Examples of real bugs found:** the ReAct parser stripped code-fences from *inside* JSON string values (corrupting `write_file` content); empty tool output produced an empty `tool_result` block the Claude API rejects; a symlink could escape the coding sandbox; `AbortSignal` wasn't propagated into the in-flight model call or shell command; a malformed JSON body returned an HTML stack trace instead of the API's `{error}` contract.

---

## 7. WebSocket reconnect — how do you avoid missing or duplicating events?

**Answer:** On (re)connect the client opens the stream *and* fetches the full history via REST, then dedupes by a stable event key. Trace events key by `toolCallId` / iteration / type; `env_state` events key by a server-assigned monotonic `seq` (added specifically so two snapshots emitted in the same millisecond can't collide). So a missed-while-offline event is recovered from history, and a duplicated live event is dropped. The reducer merges both sources idempotently.

---

## 8. How does abort work end to end?

**Answer:** Each run owns an `AbortController`. The loop checks `signal.aborted` between steps, **and** threads the signal into the work that actually blocks: `ModelRequest.signal` reaches the Ollama `fetch`, the Claude CLI child process (killed on abort), and the Anthropic SDK call; `Tool.execute(input, signal)` reaches the `run_command` shell exec (`exec` kills the process on abort). So an abort during a long model call or a 30-second command is honored, not just between iterations. (This was one of the audit fixes — originally the signal was only polled between steps.)

---

## 9. What's the hardest bug you debugged?

**Answer (pick one you can tell vividly):** The Claude-CLI provider "working then refusing." Iterations 1–2 emitted clean JSON tool calls that my loop executed; iteration 3 the model wrote prose instead — it had tried to call the tools *for real* through Claude Code's mechanism, found they didn't exist (I'd only disabled some tools, leaving others), and honestly flagged that the transcript claimed tools worked but they didn't. Root cause: I hadn't fully turned the CLI into a pure model. Fix: allowlist a single non-existent tool (disabling all real tools) and reframe the system prompt so the model knows it's a planner whose JSON an external harness runs. Verified with a fresh end-to-end run that passed.

---

## 10. If you had another week, what would you add?

**Answer:** Three things, in priority order: (1) a coding environment with **multi-file tasks** and a richer diff/patch model; (2) more eval **suites** and a persisted results store so the leaderboard survives restarts; (3) **CI-gated eval regression** — run a fixed mock suite in CI and fail the build if the pass profile changes. I'd also add a couple more local models to make the (provider, model) leaderboard a real comparison. What I'd *not* do is add an LLM judge — determinism is a feature here.

---

## Rapid-fire facts to have ready

- **Packages:** `@loopforge/core` (loop, providers, tools, events — zero framework deps), `@loopforge/server` (Express + `ws`, port 8787; also serves the LoopMart QA target on 8788), `@loopforge/web` (React + Vite dashboard).
- **Providers:** `mock` (scripted, tools execute for real), `ollama` (local, ReAct), `claude-cli` (local Claude Code CLI as a model), `anthropic` (Claude API, adaptive thinking).
- **Environments:** `coding` (sandboxed file tools + live diff), `sokoban` (in-memory engine + animated board), `browser` (Playwright + screenshots).
- **Safety:** coding tools are path-confined (lexical + realpath symlink check); browser is origin-allowlisted; `run_command` is documented as full-shell-in-sandbox (a local dev tool).
- **Tests:** 53 total (17 core + 36 server), `node:test` via `tsx`, green in GitHub Actions CI.
