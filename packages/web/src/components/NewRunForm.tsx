import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { Provider } from "../types";

interface Props {
  onStart: (provider: Provider, task: string) => Promise<void>;
}

const MOCK_PLACEHOLDER =
  "Demo: find and fix the failing test (scripted, no API key needed)";

export function NewRunForm({ onStart }: Props) {
  const [provider, setProvider] = useState<Provider>("mock");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMock = provider === "mock";
  const disabled = busy || (!isMock && task.trim().length === 0);

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
      await onStart(provider, task.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="new-run" onSubmit={(e) => void handleSubmit(e)}>
      <h2 className="section-title">New run</h2>

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
        placeholder={isMock ? MOCK_PLACEHOLDER : "Describe the task for the agent…"}
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
