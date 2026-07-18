# LoopForge Environments

> The environment layer: the pluggable seam that gives the agent loop something to *do* — a set of tools, a system prompt, and (optionally) live state — without the loop, the providers, or the dashboard knowing which world the agent is in.

**Why this exists.** The `AgentLoop` is deliberately domain-blind: it drives a `ModelProvider`, executes whatever `Tool[]` it is handed, and emits `TraceEvent`s. What the agent actually operates on — a code sandbox, a game board, a live browser, anything else — lives behind one interface, `RunEnvironment`. That single seam is why whole new domains (first Sokoban, then a Playwright-driven browser) were added in later phases without touching the core loop, and why the same four providers run against any of the three worlds unchanged. This doc covers the environment contract, the three shipped environments, how live state reaches the dashboard as `env_state`, and how to add a fourth.

---

## The `RunEnvironment` contract

An environment supplies everything run-specific the harness plugs into the loop: the tools the model may call, the system prompt that frames the task, a default task, and a few optional lifecycle hooks (`packages/server/src/environments/index.ts`).

```ts
// packages/server/src/environments/index.ts
export type EnvironmentName = "coding" | "sokoban" | "browser";

/** Callback the server wires to append + broadcast an env_state trace event. */
export type PublishState = (state: unknown) => void;

export interface RunEnvironment {
  tools: Tool[];
  systemPrompt: string;
  /** Task used for mock runs, and as the fallback when none is provided. */
  demoTask: string;
  /** Script the MockProvider plays back for this environment's demo. */
  buildDemoScript?(): MockStep[];
  /** Reset shared state before a scripted demo run (e.g. the demo sandbox). */
  prepare?(): void;
  /** Called right after run_started is recorded — publish initial state here. */
  onRunStart?(): void;
  /**
   * Best-effort teardown after the run finishes (e.g. remove a per-run temp
   * sandbox). Must not throw; the caller ignores failures.
   */
  cleanup?(): void;
}
```

Only three fields are required — `tools`, `systemPrompt`, `demoTask` — the rest are hooks the harness calls if present. The loop never sees this interface at all; it only ever receives the environment's `tools` and `systemPrompt`. Everything else is the *server's* contract with the environment.

### The factory builds a fresh instance per run

`createEnvironment` is the only entry point. It returns a **new** `RunEnvironment` for every run, so a stateful environment (a Sokoban board, a per-run sandbox directory) never leaks between runs:

```ts
// packages/server/src/environments/index.ts
export function createEnvironment(
  name: EnvironmentName,
  publishState: PublishState,
  runId: string,
): RunEnvironment {
  switch (name) {
    case "coding":
      return createCodingEnvironment(runId, publishState);
    case "sokoban":
      return createSokobanEnvironment(publishState);
    case "browser":
      return createBrowserEnvironment(publishState);
  }
}
```

`RunManager.createRun` calls this once, passing a `publishState` closure it owns (which stamps a monotonic `seq` and routes an `env_state` event through the normal broadcast path) and the `runId`. The coding environment needs the `runId` to name its private sandbox directory and `publishState` for its file-diff snapshots; the sokoban and browser environments need `publishState` to push board / page snapshots. Each takes only what it uses.

### Where the hooks fire in the run lifecycle

```mermaid
sequenceDiagram
  autonumber
  participant RM as RunManager
  participant Env as RunEnvironment
  participant Loop as AgentLoop

  RM->>Env: createEnvironment(name, publishState, runId)
  Note over Env: fresh instance — tools + systemPrompt built here
  opt mock provider
    RM->>Env: prepare()  (reset shared demo state)
  end
  RM->>Loop: new AgentLoop({ tools, systemPrompt, ... })
  Loop-->>RM: run_started
  RM->>Env: onRunStart()  (publish opening state, e.g. the board)
  loop each tool call
    Loop->>Env: tool.execute(input, signal)
    Env-->>Loop: ToolResult { output, isError? }
    opt state changed
      Env->>RM: publishState(state)  ->  env_state trace event
    end
  end
  Loop-->>RM: run_finished
  RM->>Env: cleanup()  (best-effort teardown)
```

- **`prepare?()`** runs only on the `mock` branch of `createRun`, before the scripted demo, to reset any shared demo state.
- **`onRunStart?()`** fires right after the `run_started` event is recorded, so an environment can publish its opening state *before* the first model turn (the Sokoban board shows up immediately).
- **`cleanup?()`** runs when the run reaches any terminal status — and again on the fire-and-forget error path — so a per-run sandbox is always removed. It must never throw; `RunManager` swallows failures.

See **[Architecture](ARCHITECTURE.md)** for the full run lifecycle these hooks hang off.

---

## The tool contract

An environment's `tools` are plain `Tool` objects from `@loopforge/core` (`packages/core/src/tools.ts`). A `ToolDefinition` is the part the model sees; a `Tool` adds the local `execute` the loop runs:

```ts
// packages/core/src/tools.ts
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  isError?: boolean;
}

export interface Tool extends ToolDefinition {
  execute(input: any, signal?: AbortSignal): Promise<ToolResult>;
}
```

The loop strips each tool down to its `{ name, description, inputSchema }` for the `ModelRequest` (so native and ReAct providers both advertise the same schema), then executes the matching `Tool.execute` when a call comes back. `execute` receives the model-produced input (which it validates itself) and the run's `AbortSignal`, and returns a `ToolResult` whose `output` becomes the `tool_finished` event's output and the next turn's `tool_result` block.

---

## The `coding` environment

A sandboxed JavaScript project the agent debugs. `createCodingEnvironment(runId, publishState)` (`packages/server/src/environments/coding.ts`) wires four tools rooted in a **per-run** temp directory, plus the coding system prompt and the scripted bug-fix demo. The `write_file` tool is additionally wrapped to publish live file-diff snapshots (below).

```ts
// packages/server/src/environments/coding.ts
export function createCodingEnvironment(
  runId: string,
  publishState: PublishState,
): RunEnvironment {
  const sandboxDir = path.join(os.tmpdir(), `loopforge-run-${runId}`);
  resetDemoSandbox(sandboxDir);           // seed the BROKEN calc.js + tests

  const tools = createCodingTools(sandboxDir).map((tool) =>
    tool.name === "write_file" ? withDiffSnapshots(tool, sandboxDir, publishState) : tool,
  );

  return {
    tools,
    systemPrompt: SYSTEM_PROMPT,
    demoTask: DEMO_TASK,
    buildDemoScript,
    prepare: () => resetDemoSandbox(sandboxDir),
    cleanup: () => { /* best-effort rmSync of the temp dir */ },
  };
}
```

### Per-run isolation

Each run gets its own working copy at `os.tmpdir()/loopforge-run-<runId>`, seeded from the demo constants — **always the broken `calc.js` plus the tests** — not from the on-disk `sandbox/demo-project`. So every coding run starts from the identical failing state regardless of what a prior run left behind, and parallel eval runs never stomp each other. `cleanup` removes the temp dir when the run finishes (best-effort; the OS reclaims `tmpdir` either way).

The planted bug lives in the seed constant (`packages/server/src/demo.ts`): `add` is implemented as `a - b`, and the fix is `a + b`.

```ts
// packages/server/src/demo.ts — ORIGINAL_CALC (seeded into every run)
function add(a, b) {
  return a - b;   // the bug: subtraction where the test expects addition
}
```

### The four tools (`createCodingTools`)

`createCodingTools(sandboxRoot)` (`packages/core/src/coding-tools.ts`) returns four tools, all rooted at and confined to the sandbox:

| Tool | Input | Behavior |
|---|---|---|
| `read_file` | `{ path }` | Reads a file as UTF-8; output truncated at 50,000 chars. |
| `write_file` | `{ path, content }` | Writes a file, creating parent dirs; overwrites. Returns the byte count. |
| `list_files` | `{ path? }` | Recursive listing; skips `node_modules` / `.git` / `dist`; capped at 200 files. |
| `run_command` | `{ command }` | Runs a shell command with `cwd` = sandbox root, **30s timeout**, 1 MB buffer; returns stdout, stderr, and `[exit code: n]`. Honors the run's abort signal. |

### `coding_files` diff snapshots — live file diffs on the trace stream

`withDiffSnapshots` (`packages/server/src/environments/coding.ts`) wraps the sandbox `write_file` tool so every **successful** write publishes a cumulative `env_state` snapshot:

```ts
// the env_state shape for coding runs (server<->web contract)
{
  kind: "coding_files",
  changes: [{ path, before, after }],   // one entry per file ever written this run
}
```

The semantics are chosen so the dashboard can render a stable, honest diff:

- **Cumulative, in first-write order.** `changes` lists every file written so far this run, keyed by resolved absolute path (so `a.js` and `./a.js` share one entry), in the order each file was first touched.
- **`before` is frozen at the first write.** It captures the content that existed before the run's *first* write of that file (`null` when the file did not exist), and never changes afterwards — so the diff always reads "what this run did to the file," not "the last incremental edit." `after` tracks the most recently written content.
- **50k truncation.** Both sides are cut at `SNAPSHOT_MAX_CHARS` (50,000 chars) with an `… (truncated)` suffix, mirroring `read_file`'s cap.
- **Failed writes publish nothing.** The wrapper delegates to the real tool first; an error result (e.g. a path escaping the sandbox) records and publishes no snapshot.
- **Published copies are immutable.** Each publish deep-copies the entries, so snapshots already appended to the run log never mutate when a later write advances `after`.

On the dashboard, `FileChangesPanel` (`packages/web/src/components/FileChangesPanel.tsx`) renders the latest `coding_files` snapshot in the same layout slot the Sokoban board uses: one card per file (with a `new file` badge when `before === null`), each showing a collapsed unified diff computed by the dependency-free LCS differ in `packages/web/src/diff.ts` (`computeLineDiff` + `collapseContext` — common prefix/suffix trimmed first, long unchanged runs folded into "⋯ n unchanged lines" rows).

### Sandbox confinement is `realpath`-based, not lexical

Path safety is the load-bearing detail. `resolveInside` first does a fast lexical reject, then — as defense in depth — resolves symlinks on the nearest existing ancestor and re-checks against the **real** sandbox root, so a symlink *inside* the sandbox can't point outside it:

```ts
// packages/core/src/coding-tools.ts
const resolved = path.resolve(root, relativePath);
// Fast lexical reject.
if (resolved !== root && !resolved.startsWith(root + path.sep)) {
  throw new Error(`Path escapes the sandbox: ${relativePath}`);
}
// Defense in depth: realpath the nearest existing ancestor and re-check
// against the REAL sandbox root (a symlink inside can't escape).
const real = await fs.realpath(probe);
if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
  throw new Error(`Path escapes the sandbox (symlink): ${relativePath}`);
}
```

This is exercised by a regression test — a symlink inside the sandbox pointing at `/etc` is rejected (`packages/core/src/coding-tools.test.ts`). See **[Development](DEVELOPMENT.md)** for the test suite, and the security note below.

### Security posture

`run_command` executes real shell commands. It is confined to the per-run sandbox directory and time-boxed to 30 seconds, and runs only start when *you* start them — this is a **local development / portfolio tool**, not a hardened multi-tenant sandbox. There is no syscall or network isolation; a command can still reach the network or spend CPU within its 30s window. Run LoopForge on your own machine, not as an untrusted-input service.

---

## The `sokoban` environment

A box-pushing puzzle arena — proof that the harness is genuinely pluggable, since nothing in `@loopforge/core` knows this game exists. `createSokobanEnvironment(publishState)` (`packages/server/src/environments/sokoban.ts`) wraps a pure `SokobanGame` engine in two tools.

### The engine and its state

`SokobanGame` holds the board and enforces the rules: the player moves one tile; walking into a box pushes it one tile *if* the tile behind it is free (not a wall, not another box); boxes can never be pulled. A level is solved once every box sits on a goal. The shipped level is 8×6 with two boxes and two goals:

```ts
// packages/server/src/environments/sokoban.ts
export const SOKOBAN_LEVEL = [
  "########",
  "#   .  #",
  "#  $$  #",
  "#  @ . #",
  "#      #",
  "########",
];
// legend: # wall, . goal, $ box, * box on goal, @ player, + player on goal
```

`game.state()` returns the exact JSON shape the server↔web contract uses — this is what rides inside an `env_state` event:

```ts
// packages/server/src/environments/sokoban.ts
export interface SokobanState {
  width: number;
  height: number;
  walls: [number, number][];
  goals: [number, number][];
  boxes: [number, number][];
  player: [number, number];
  moveCount: number;
  solved: boolean;      // true iff every box is on a goal
}
```

### The two tools

- **`look`** — takes no input; returns the ASCII board, the legend, and the status line (`Boxes on goals: n/m`, plus ` SOLVED!` once complete). Read-only, so it publishes nothing.
- **`move`** — takes `{ direction: "up" | "down" | "left" | "right" }`; validates the direction, applies it to the real `SokobanGame`, and **on a successful move publishes an `env_state` snapshot** so the dashboard board animates live:

```ts
// packages/server/src/environments/sokoban.ts
const result = game.move(direction);
if (!result.ok) {
  return { output: result.description, isError: true };   // blocked — no publish
}
publishState(game.state());                                // board changed -> env_state
return { output: `${result.description}\n${game.ascii()}\n${game.status()}` };
```

The environment also sets `onRunStart: () => publishState(game.state())` so the opening board is published before the first model turn.

---

## The `browser` environment

An autonomous **web-QA agent**: the loop drives a real headless Chromium (via [Playwright](https://playwright.dev)) against a seeded demo shop and is asked to verify the checkout flow — which is deliberately broken. `createBrowserEnvironment(publishState)` (`packages/server/src/environments/browser.ts`) wires four browser tools, the QA system prompt, and the scripted find-the-bug demo.

### The target: LoopMart and its planted bug

The server itself hosts the QA target — **LoopMart**, a tiny deterministic shop served from inline HTML by `startTargetSite` (`packages/server/src/target-site.ts`) on port **8788**, separate from the LoopForge API on 8787. It has a home page, a three-product catalog (each with an *Add to cart* link), and a checkout form. The checkout flow carries **one planted bug**:

```ts
// packages/server/src/target-site.ts
/** THE PLANTED BUG: placing an order always fails with a 500. */
if (req.method === "POST" && pathname === "/order") {
  // Drain the form body we never read, then fail — this is the bug.
  req.resume();
  sendHtml(res, 500, ORDER_ERROR_PAGE);
  return;
}
```

The error page renders `Internal Server Error (500)` with the code `ERR_ORDER_FAILED` — the exact marker the eval scorer (and the dashboard's bug chip) looks for. The browser environment's whole reason to exist is finding it.

### The origin allowlist

The QA sandbox may visit **only** the seeded shop. `TARGET_ORIGIN` (`http://localhost:8788`) is checked in `goto` **before any browser work** — a blocked URL returns an `isError` result without ever launching Chromium:

```ts
// packages/server/src/environments/browser.ts
/** The only origin the QA sandbox may visit. */
export const TARGET_ORIGIN = "http://localhost:8788";

if (parsed.origin !== TARGET_ORIGIN) {
  return { output: ORIGIN_BLOCKED_MESSAGE, isError: true };
}
```

### The four tools

All four target visible text rather than CSS selectors, so a model can drive them from `read_page` output alone:

| Tool | Input | Behavior |
|---|---|---|
| `goto` | `{ url }` | Navigates to a URL on `TARGET_ORIGIN` (anything else is blocked); waits for load; returns a page summary. |
| `read_page` | — | Summarizes the current page: URL, title, headings, visible body text (truncated at 2,000 chars), and every clickable link/button by its visible text. |
| `click` | `{ text }` | Clicks the first `a`/`button` whose visible text matches (case-insensitive, trimmed); arms a `framenavigated` listener *before* clicking so a fast navigation or form POST is never missed (5s timeout if none); returns a summary of the resulting page. On a miss it lists the clickables that *are* available. |
| `fill` | `{ field, value }` | Fills the first `input`/`textarea`/`select` whose placeholder, `aria-label`, or associated label matches the field name (case-insensitive, substring). |

### `env_state`: the page snapshot with a screenshot

After every **successful** `goto` or `click` (the two tools that change the page), the environment publishes a snapshot including a real viewport screenshot, so the dashboard shows what the agent sees:

```ts
// packages/server/src/environments/browser.ts
export interface BrowserState {
  kind: "browser";
  url: string;
  title: string;
  steps: number;
  /** data:image/jpeg;base64,... viewport screenshot. */
  screenshot: string;
}
```

Screenshots are kept light on purpose — an 800×600 viewport captured as JPEG at quality 45, embedded as a data URL — because each snapshot rides the normal `env_state` trace pipeline into the run log and over the WebSocket.

### Lifecycle: lazy Playwright, graceful degradation

Playwright is a real dependency (`packages/server/package.json`) but it is imported **lazily inside the launcher, with a non-literal specifier** so `tsc` never resolves the module — typechecking and server boot succeed even when the package or its Chromium binary is missing. The first tool call that needs a page triggers the launch; a failed launch is cached (`pagePromise`) so every later tool reports the same actionable error instead of retrying:

- missing package → `The "playwright" package is not installed (…). Run npm install, then npx playwright install chromium.`
- missing binary → `Failed to launch headless Chromium (…). Install the browser binary with: npx playwright install chromium`

Either way the tools return `isError` results, the run finishes normally, and nothing crashes the server. `cleanup` closes the page and browser best-effort (async, failures swallowed) when the run ends.

The environment also provides `buildDemoScript` (`buildBrowserDemoScript`) — the scripted mock demo that walks home → products → add to cart → fill the name → *Place order*, observes the planted 500, and reports the bug with reproduction steps. Its negative twin, `buildStuckBrowserScript`, browses without ever submitting an order (see **[Eval Harness](EVAL_HARNESS.md)** for how the `web-qa` suite uses both).

### How `BrowserPanel` renders it

`BrowserPanel` (`packages/web/src/components/BrowserPanel.tsx`) occupies the same layout slot as the Sokoban board and renders the **latest** `browser` snapshot: the live URL readout, the viewport screenshot, and a step counter. It also shows a red **BUG OBSERVED** chip once any successful `click` result in the run's event stream contains `Internal Server Error (500)` — deliberately mirroring the server-side browser scorer, so what the panel flags is exactly what the eval would score as a pass. Before the first snapshot arrives it shows a "waiting for the first page…" placeholder (snapshots are validated by `isBrowserState` in `packages/web/src/browserState.ts`, so a malformed payload degrades to the placeholder instead of crashing).

---

## `env_state`: live state on the trace pipeline

An environment's live state does not travel on a side channel — it flows through the **same** `TraceEvent` stream as loop events, so the dashboard, the event log, and the scorer all see it. The environment calls `publishState(state)`; `RunManager` wraps it in an `env_state` event, stamps a monotonic per-run `seq`, and broadcasts it like any other trace event:

```ts
// packages/server/src/run-manager.ts
let envSeq = 0;
const publishState = (state: unknown): void => {
  const record = this.runs.get(runId);
  if (!record) return;
  this.handleEvent(record, {
    type: "env_state",
    runId,
    seq: envSeq++,     // monotonic: distinct snapshots never collide
    state,
    at: Date.now(),
  });
};
```

Two consequences worth stressing:

- **The loop never emits `env_state`.** It is emitted by the harness *around* the loop. That is why the `TraceEvent` union documents it as environment-published (`packages/core/src/events.ts`), and why an environment needs `publishState` but the loop does not.
- **`seq` is the dedupe key.** Two snapshots emitted in the same millisecond would collide on timestamp alone; the monotonic `seq` gives each a stable identity, and the dashboard dedupes on `env_state:<seq>` so a history-fetched snapshot and its live WebSocket duplicate collapse into one while two genuine snapshots stay distinct.

---

## How the scorer reads each environment

Success is defined per environment, and judged **only** from the recorded events — no live game state, no sandbox inspection (`packages/server/src/eval/scorer.ts`):

- **coding** passes iff some `run_command` that *actually executes the tests* (correlated by `toolCallId` back to a command `isTestExecution` accepts — `node … test`, `npm test`, `npx … test`) finished without error and printed `"All tests passed"`. Reading or `cat`-ing `test.js` — whose source contains that literal — cannot false-pass.
- **sokoban** passes iff some published `env_state` reports `solved === true`.
- **browser** passes iff some **successful** `click` result contains `"Internal Server Error (500)"` — the agent must actually exercise the broken order flow; an errored click or a non-click tool surfacing the text does not count.

Because the sokoban verdict is literally "did a `solved` snapshot ever appear," the environment's decision to publish only on real state changes *is* the scoring signal. Full details in **[Eval Harness](EVAL_HARNESS.md)**.

---

## How to add an environment

The seam is small on purpose — a new world is a contained addition that touches no provider and no loop code.

1. **Implement `RunEnvironment`.** Create `packages/server/src/environments/<name>.ts` exporting a `create<Name>Environment(...)` that returns `{ tools, systemPrompt, demoTask }` plus any hooks you need. Author each `Tool` with a clear `name`, `description`, JSON-Schema `inputSchema`, and an `execute` that validates its own input and returns a `ToolResult`. If your world has visual state, call the `publishState` closure whenever it changes and add `onRunStart` to publish the opening state.

2. **Register it in the factory.** Add the name to `EnvironmentName` and a `case` to `createEnvironment` (`packages/server/src/environments/index.ts`).

3. **Add a scorer branch.** Extend `scoreRun` (`packages/server/src/eval/scorer.ts`) with the success condition for your environment, read purely from the `TraceEvent[]`.

4. **Wire the REST validation.** Extend the `environment` allow-list in `POST /api/runs` (`packages/server/src/index.ts`) so the new name is accepted.

5. **Surface it in the dashboard.** Add the option to the run form and, if it has custom state, a renderer for its `env_state` (`SokobanBoard`, `FileChangesPanel`, and `BrowserPanel` are the models to follow — each pairs a runtime type guard with a panel in the arena slot).

6. **Optionally add a demo + suite tasks.** Provide `buildDemoScript` (and a `prepare` reset) so `mock` runs and evals can exercise it deterministically, then add tasks to a suite (**[Eval Harness](EVAL_HARNESS.md)**).

Because the loop only ever sees `tools` + `systemPrompt`, and the scorer only ever sees `TraceEvent`s, a correct `RunEnvironment` works everywhere — manual runs, every provider, and the eval harness — with no changes to core.

---

## Related documentation

- **[Architecture](ARCHITECTURE.md)** — the run lifecycle the environment hooks fire in, and the `TraceEvent` model.
- **[Providers](PROVIDERS.md)** — the models that drive an environment's tools; native tools vs. the ReAct adapter.
- **[Eval Harness](EVAL_HARNESS.md)** — how each environment's success condition is scored and aggregated.
- **[Development](DEVELOPMENT.md)** — running locally and the environment test suites.
- **[Documentation index](README.md)** — all docs in reading order.
