import { useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { Provider, Suite } from "../types";
import { MODEL_PLACEHOLDERS } from "./NewRunForm";

interface Props {
  suites: Suite[];
  onCreate: (body: {
    suiteId: string;
    provider: Provider;
    repeats: number;
    model?: string;
  }) => Promise<void>;
}

/** Fallback so the form is usable before /api/suites resolves (or if it fails). */
const DEMO_FALLBACK: Suite = {
  id: "demo",
  name: "Mixed demo suite",
  tasks: [],
};

export function NewEvalForm({ suites, onCreate }: Props) {
  const options = suites.length > 0 ? suites : [DEMO_FALLBACK];
  const defaultSuite =
    options.find((s) => s.id === "demo")?.id ?? options[0].id;

  const [suiteId, setSuiteId] = useState(defaultSuite);
  const [provider, setProvider] = useState<Provider>("mock");
  const [model, setModel] = useState("");
  const [repeats, setRepeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the selection valid as suites arrive asynchronously.
  const validSuiteId = useMemo(
    () => (options.some((s) => s.id === suiteId) ? suiteId : defaultSuite),
    [options, suiteId, defaultSuite]
  );

  const handleSuite = (e: ChangeEvent<HTMLSelectElement>) => {
    setSuiteId(e.target.value);
    setError(null);
  };

  const handleProvider = (e: ChangeEvent<HTMLSelectElement>) => {
    setProvider(e.target.value as Provider);
    // Model names are provider-specific; reset to "use the provider default".
    setModel("");
    setError(null);
  };

  const handleRepeats = (e: ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (Number.isNaN(n)) return;
    setRepeats(Math.max(1, Math.min(5, Math.round(n))));
    setError(null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const trimmedModel = model.trim();
      await onCreate({
        suiteId: validSuiteId,
        provider,
        repeats,
        // "model" travels only when a non-empty override was typed.
        ...(provider !== "mock" && trimmedModel.length > 0
          ? { model: trimmedModel }
          : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start eval");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="new-run" onSubmit={(e) => void handleSubmit(e)}>
      <h2 className="section-title">New eval</h2>

      <label className="field-label" htmlFor="new-eval-suite">
        Suite
      </label>
      <select
        id="new-eval-suite"
        className="select"
        value={validSuiteId}
        onChange={handleSuite}
      >
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.tasks.length > 0 ? ` (${s.tasks.length} tasks)` : ""}
          </option>
        ))}
      </select>

      <label className="field-label" htmlFor="new-eval-provider">
        Provider
      </label>
      <select
        id="new-eval-provider"
        className="select"
        value={provider}
        onChange={handleProvider}
      >
        <option value="mock">Mock (scripted demo)</option>
        <option value="ollama">Local (Ollama · llama3)</option>
        <option value="claude-cli">Claude CLI (local account)</option>
        <option value="anthropic">Anthropic (live API)</option>
      </select>

      {provider !== "mock" && (
        <>
          <label className="field-label" htmlFor="new-eval-model">
            Model <span className="field-hint">optional</span>
          </label>
          <input
            id="new-eval-model"
            className="select input-text"
            type="text"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setError(null);
            }}
            placeholder={MODEL_PLACEHOLDERS[provider]}
            spellCheck={false}
            autoComplete="off"
          />
        </>
      )}

      <label className="field-label" htmlFor="new-eval-repeats">
        Repeats <span className="field-hint">per task, 1–5</span>
      </label>
      <input
        id="new-eval-repeats"
        className="select input-number"
        type="number"
        min={1}
        max={5}
        step={1}
        value={repeats}
        onChange={handleRepeats}
      />

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={busy}
      >
        {busy ? "Starting…" : "Start eval"}
      </button>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
