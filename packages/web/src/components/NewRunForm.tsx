import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { Environment, Provider } from "../types";

interface Props {
  onStart: (
    provider: Provider,
    environment: Environment,
    task: string
  ) => Promise<void>;
}

const MOCK_PLACEHOLDERS: Record<Environment, string> = {
  coding: "Demo: find and fix the failing test (scripted, no API key needed)",
  sokoban: "Demo: agent solves a Sokoban level (scripted, no API key needed)",
};

export function NewRunForm({ onStart }: Props) {
  const [environment, setEnvironment] = useState<Environment>("coding");
  const [provider, setProvider] = useState<Provider>("mock");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMock = provider === "mock";
  // Anthropic + sokoban may omit the task: the server falls back to the
  // standard Sokoban demo task. Anthropic + coding still requires one.
  const taskRequired = !isMock && environment === "coding";
  const disabled = busy || (taskRequired && task.trim().length === 0);

  const placeholder = isMock
    ? MOCK_PLACEHOLDERS[environment]
    : environment === "sokoban"
      ? "Optional — leave empty for the standard Sokoban task"
      : "Describe the task for the agent…";

  const handleEnvironment = (e: ChangeEvent<HTMLSelectElement>) => {
    setEnvironment(e.target.value as Environment);
    setError(null);
  };

  const handleProvider = (e: ChangeEvent<HTMLSelectElement>) => {
    setProvider(e.target.value as Provider);
    setError(null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onStart(provider, environment, task.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="new-run" onSubmit={(e) => void handleSubmit(e)}>
      <h2 className="section-title">New run</h2>

      <label className="field-label" htmlFor="new-run-environment">
        Environment
      </label>
      <select
        id="new-run-environment"
        className="select"
        value={environment}
        onChange={handleEnvironment}
      >
        <option value="coding">Coding sandbox</option>
        <option value="sokoban">Sokoban arena</option>
      </select>

      <label className="field-label" htmlFor="new-run-provider">
        Provider
      </label>
      <select
        id="new-run-provider"
        className="select"
        value={provider}
        onChange={handleProvider}
      >
        <option value="mock">Mock (scripted demo)</option>
        <option value="anthropic">Anthropic (live API)</option>
      </select>

      <label className="field-label" htmlFor="new-run-task">
        Task
      </label>
      <textarea
        id="new-run-task"
        className="textarea"
        rows={3}
        disabled={isMock}
        value={isMock ? "" : task}
        onChange={(e) => setTask(e.target.value)}
        placeholder={placeholder}
      />

      <button type="submit" className="btn btn-primary btn-block" disabled={disabled}>
        {busy ? "Starting…" : "Start run"}
      </button>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
