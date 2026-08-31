/**
 * Suggested changes, in GitHub's own format: a fenced block tagged
 * `suggestion`, whose contents replace the commented lines.
 *
 * Nothing here invents a format. The body is stored and posted verbatim, so a
 * suggestion written in this app is the same text GitHub renders an "Apply
 * suggestion" button on. This module only reads it back out, so the note can be
 * shown as a suggestion locally too.
 */

const OPEN = "```suggestion";
const CLOSE = "```";

export interface NoteBody {
  /** The words around the suggestion. May be empty. */
  readonly prose: string;
  /**
   * The replacement lines, or null when the note carries no suggestion. An
   * empty string is a real suggestion: it deletes the commented lines.
   */
  readonly suggestion: string | null;
}

/** A paste can bring carriage returns; they are not part of the code. */
const lines = (body: string): readonly string[] => body.replace(/\r\n?/g, "\n").split("\n");

export function parseNoteBody(body: string): NoteBody {
  const rows = lines(body);
  const open = rows.findIndex((row) => row.trim() === OPEN);
  if (open === -1) return { prose: body.trim(), suggestion: null };

  const close = rows.findIndex((row, index) => index > open && row.trim() === CLOSE);
  // An unterminated fence is someone still typing, or prose about suggestions.
  // Reading it as a suggestion would post half a replacement.
  if (close === -1) return { prose: body.trim(), suggestion: null };

  return {
    prose: [...rows.slice(0, open), ...rows.slice(close + 1)].join("\n").trim(),
    suggestion: rows.slice(open + 1, close).join("\n"),
  };
}

export const hasSuggestion = (body: string): boolean => parseNoteBody(body).suggestion !== null;

/** The body to store: prose first, then the fence, as GitHub expects. */
export const withSuggestion = (prose: string, replacement: string): string => {
  const fence = `${OPEN}\n${replacement}\n${CLOSE}`;
  const words = prose.trim();
  return words === "" ? fence : `${words}\n\n${fence}`;
};
