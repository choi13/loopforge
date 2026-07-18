/**
 * Dependency-free line-based diff for the file-changes panel.
 *
 * `computeLineDiff` produces a full op list (context / add / del) via an LCS
 * alignment; `collapseContext` then folds long unchanged stretches down to a
 * couple of context lines around each change, inserting "skip" separator rows.
 * Pure functions with zero DOM or React dependencies so they are trivially
 * testable and safe to run on every render (memoize upstream).
 */

export interface DiffOp {
  type: "ctx" | "add" | "del";
  text: string;
}

/** A rendered diff row: a real op, or a collapsed run of `count` context lines. */
export type DiffRow = DiffOp | { type: "skip"; count: number };

/**
 * Guard rail for pathological inputs: beyond this many DP cells the LCS table
 * would get slow/heavy, so the middle section degrades to delete-all/add-all.
 * Snapshots are capped server-side at 50k chars, and the common prefix/suffix
 * trim below means realistic edits never come close to this.
 */
const LCS_CELL_LIMIT = 1_000_000;

/**
 * Split file content into lines, dropping the phantom empty line a trailing
 * newline would otherwise create ("a\nb\n" is two lines, not three).
 * Empty content is zero lines.
 */
function splitLines(s: string): string[] {
  if (s.length === 0) return [];
  const lines = s.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** LCS-based diff of the (already prefix/suffix-trimmed) middle sections. */
function diffCore(xs: string[], ys: string[]): DiffOp[] {
  if (xs.length === 0) return ys.map((text) => ({ type: "add", text }));
  if (ys.length === 0) return xs.map((text) => ({ type: "del", text }));

  const n = xs.length;
  const m = ys.length;
  const ops: DiffOp[] = [];

  if (n * m > LCS_CELL_LIMIT) {
    // Degenerate but correct fallback for enormous, mostly-rewritten files.
    for (const text of xs) ops.push({ type: "del", text });
    for (const text of ys) ops.push({ type: "add", text });
    return ops;
  }

  // table[i * width + j] = LCS length of xs[i..] vs ys[j..]
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * width;
    const below = row + width;
    for (let j = m - 1; j >= 0; j--) {
      table[row + j] =
        xs[i] === ys[j]
          ? table[below + j + 1] + 1
          : Math.max(table[below + j], table[row + j + 1]);
    }
  }

  // Walk the table front-to-back, preferring deletions before additions so
  // hunks read in conventional unified-diff order.
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (xs[i] === ys[j]) {
      ops.push({ type: "ctx", text: xs[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push({ type: "del", text: xs[i] });
      i++;
    } else {
      ops.push({ type: "add", text: ys[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", text: xs[i++] });
  while (j < m) ops.push({ type: "add", text: ys[j++] });
  return ops;
}

/**
 * Line-based diff of `before` -> `after`. Trims the common prefix/suffix first
 * (the overwhelmingly common case for incremental agent edits) and LCS-aligns
 * only the changed middle, so typical calls are near-linear.
 */
export function computeLineDiff(before: string, after: string): DiffOp[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let start = 0;
  const minLen = Math.min(a.length, b.length);
  while (start < minLen && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: DiffOp[] = [];
  for (let k = 0; k < start; k++) ops.push({ type: "ctx", text: a[k] });
  for (const op of diffCore(a.slice(start, endA), b.slice(start, endB))) {
    ops.push(op);
  }
  for (let k = endA; k < a.length; k++) ops.push({ type: "ctx", text: a[k] });
  return ops;
}

/**
 * Collapse long unchanged runs down to `context` lines adjacent to each
 * change, replacing the elided middle with a `skip` row. Context at the very
 * start/end of the file (not adjacent to any change) is elided entirely.
 */
export function collapseContext(ops: DiffOp[], context = 2): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type !== "ctx") {
      rows.push(ops[i]);
      i++;
      continue;
    }
    let end = i;
    while (end < ops.length && ops[end].type === "ctx") end++;
    const runLen = end - i;
    const keepHead = i === 0 ? 0 : context; // trailing context of the prior change
    const keepTail = end === ops.length ? 0 : context; // leading context of the next
    if (runLen <= keepHead + keepTail) {
      for (let k = i; k < end; k++) rows.push(ops[k]);
    } else {
      for (let k = i; k < i + keepHead; k++) rows.push(ops[k]);
      rows.push({ type: "skip", count: runLen - keepHead - keepTail });
      for (let k = end - keepTail; k < end; k++) rows.push(ops[k]);
    }
    i = end;
  }
  return rows;
}
