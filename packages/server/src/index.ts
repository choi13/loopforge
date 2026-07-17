import http from "node:http";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { RunManager, type ServerMessage } from "./run-manager";
import { EvalManager, type EvalMessage } from "./eval-manager";
import { getSuite, listSuites, toPublicTask } from "./eval/suites";

const PORT = 8787;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const sockets = new Set<WebSocket>();
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

function broadcast(message: ServerMessage | EvalMessage): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

const runManager = new RunManager(broadcast);
const evalManager = new EvalManager(runManager, broadcast);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/runs", (_req, res) => {
  res.json({ runs: runManager.listRuns() });
});

app.get("/api/runs/:id", (req, res) => {
  const run = runManager.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: `No run with id ${req.params.id}` });
    return;
  }
  res.json({ run: run.summary, events: run.events });
});

app.post("/api/runs", (req, res) => {
  const body: unknown = req.body;
  const provider =
    typeof body === "object" && body !== null
      ? (body as { provider?: unknown }).provider
      : undefined;
  if (provider !== "mock" && provider !== "anthropic") {
    res.status(400).json({ error: 'provider must be "mock" or "anthropic"' });
    return;
  }

  const rawEnvironment =
    typeof body === "object" && body !== null
      ? (body as { environment?: unknown }).environment
      : undefined;
  if (
    rawEnvironment !== undefined &&
    rawEnvironment !== "coding" &&
    rawEnvironment !== "sokoban"
  ) {
    res.status(400).json({ error: 'environment must be "coding" or "sokoban"' });
    return;
  }
  const environment = rawEnvironment ?? "coding";

  const rawTask =
    typeof body === "object" && body !== null
      ? (body as { task?: unknown }).task
      : undefined;
  const task = typeof rawTask === "string" ? rawTask.trim() : "";

  if (provider === "anthropic") {
    // Sokoban has a built-in default task; coding tasks are free-form and required.
    if (!task && environment === "coding") {
      res.status(400).json({ error: "A task is required for the anthropic provider" });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(400).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
      return;
    }
  }

  // For "mock", RunManager ignores the task and forces the environment's demo task.
  const run = runManager.createRun(provider, task, environment);
  res.status(201).json({ run });
});

app.post("/api/runs/:id/abort", (req, res) => {
  if (!runManager.abort(req.params.id)) {
    res.status(404).json({ error: `No run with id ${req.params.id}` });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/suites", (_req, res) => {
  const suites = listSuites().map((suite) => ({
    id: suite.id,
    name: suite.name,
    tasks: suite.tasks.map(toPublicTask),
  }));
  res.json({ suites });
});

app.post("/api/evals", (req, res) => {
  const body: unknown = req.body;
  const get = (key: string): unknown =>
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)[key]
      : undefined;

  const provider = get("provider");
  if (provider !== "mock" && provider !== "anthropic") {
    res.status(400).json({ error: 'provider must be "mock" or "anthropic"' });
    return;
  }

  const rawSuiteId = get("suiteId");
  if (rawSuiteId !== undefined && typeof rawSuiteId !== "string") {
    res.status(400).json({ error: "suiteId must be a string" });
    return;
  }
  const suiteId = rawSuiteId ?? "demo";
  if (!getSuite(suiteId)) {
    res.status(400).json({ error: `Unknown suite: ${suiteId}` });
    return;
  }

  const rawRepeats = get("repeats");
  let repeats = 1;
  if (rawRepeats !== undefined) {
    if (
      typeof rawRepeats !== "number" ||
      !Number.isInteger(rawRepeats) ||
      rawRepeats < 1 ||
      rawRepeats > 5
    ) {
      res.status(400).json({ error: "repeats must be an integer between 1 and 5" });
      return;
    }
    repeats = rawRepeats;
  }

  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    res.status(400).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
    return;
  }

  const summary = evalManager.create({ suiteId, provider, repeats });
  res.status(201).json({ eval: summary });
});

app.get("/api/evals", (_req, res) => {
  res.json({ evals: evalManager.list() });
});

app.get("/api/evals/:id", (req, res) => {
  const summary = evalManager.get(req.params.id);
  if (!summary) {
    res.status(404).json({ error: `No eval with id ${req.params.id}` });
    return;
  }
  res.json({ eval: summary });
});

server.listen(PORT, () => {
  console.log(`LoopForge server listening on http://localhost:${PORT}`);
});
