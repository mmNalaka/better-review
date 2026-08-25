/**
 * Review marks, per ticket 04 — content-addressed and file-level for now.
 * In memory only: the JSON-per-PR persistence 04 specifies is a later step.
 */
export type ReviewState = "none" | "reviewed";

export interface Marks {
  readonly reviewed: ReadonlySet<string>;
}

export const emptyMarks: Marks = { reviewed: new Set() };

export function toggleReviewed(marks: Marks, path: string): Marks {
  const next = new Set(marks.reviewed);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return { reviewed: next };
}

export const stateOf = (marks: Marks, path: string): ReviewState =>
  marks.reviewed.has(path) ? "reviewed" : "none";
