import { useMemo, useState } from "react";

const COLLAPSE_AFTER = 6;

interface Props {
  value: unknown;
}

/** Pretty-printed JSON, collapsed to the first 6 lines when longer. */
export function JsonBlock({ value }: Props) {
  const text = useMemo(() => {
    if (value === undefined) return "undefined";
    try {
      const json = JSON.stringify(value, null, 2);
      return typeof json === "string" ? json : String(value);
    } catch {
      return String(value);
    }
  }, [value]);

  const lines = useMemo(() => text.split("\n"), [text]);
  const collapsible = lines.length > COLLAPSE_AFTER;
  const [expanded, setExpanded] = useState(false);

  const shown =
    collapsible && !expanded
      ? `${lines.slice(0, COLLAPSE_AFTER).join("\n")}\n⋯`
      : text;

  return (
    <div className="json-block">
      <pre className="json">{shown}</pre>
      {collapsible && (
        <button
          type="button"
          className="link-btn"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Collapse" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
