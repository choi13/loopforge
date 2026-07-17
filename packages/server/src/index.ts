import http from "node:http";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { RunManager, type ServerMessage } from "./run-manager";

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

function broadcast(message: ServerMessage): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

const runManager = new RunManager(broadcast);

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

  const rawTask =
    typeof body === "object" && body !== null
      ? (body as { task?: unknown }).task
      : undefined;
  const task = typeof rawTask === "string" ? rawTask.trim() : "";

  if (provider === "anthropic") {
    if (!task) {
      res.status(400).json({ error: "A task is required for the anthropic provider" });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(400).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
      return;
    }
  }

  // For "mock", RunManager ignores the task and forces the built-in demo task.
  const run = runManager.createRun(provider, task);
  res.status(201).json({ run });
});

app.post("/api/runs/:id/abort", (req, res) => {
  if (!runManager.abort(req.params.id)) {
    res.status(404).json({ error: `No run with id ${req.params.id}` });
    return;
  }
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`LoopForge server listening on http://localhost:${PORT}`);
});
