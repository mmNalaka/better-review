/**
 * Every keyboard shortcut, in one list.
 *
 * The bindings and the help panel both read this, so a shortcut cannot exist
 * without being documented, and the panel cannot lie about one that changed.
 */

export interface Shortcut {
  /** `event.key`, matched after the modifier check. */
  readonly key: string;
  /** How to write it on screen. */
  readonly shown: string;
  readonly does: string;
  readonly group: "Moving" | "Reviewing" | "Views";
}

export const SHORTCUTS: readonly Shortcut[] = [
  { key: "j", shown: "j", does: "Next changed file", group: "Moving" },
  { key: "k", shown: "k", does: "Previous changed file", group: "Moving" },
  { key: "n", shown: "n", does: "Next hunk in this file, or next change when comparing", group: "Moving" },
  { key: "p", shown: "p", does: "Previous hunk", group: "Moving" },
  { key: "[", shown: "[", does: "Back one hop along the trail", group: "Moving" },
  { key: "]", shown: "]", does: "Forward one hop, until you jump somewhere new", group: "Moving" },
  { key: "Backspace", shown: "⌫", does: "Back to the changes", group: "Moving" },
  { key: "/", shown: "/", does: "Jump to the pull request field", group: "Moving" },
  { key: "r", shown: "r", does: "Callers of the last symbol you clicked (or ⌥-click one)", group: "Moving" },
  { key: "b", shown: "b", does: "Callers a changed signature left behind", group: "Reviewing" },

  { key: "v", shown: "v", does: "Mark this file reviewed, or clear it", group: "Reviewing" },
  { key: "c", shown: "c", does: "Open the findings drawer", group: "Reviewing" },
  { key: "s", shown: "s", does: "Show the commits", group: "Reviewing" },
  { key: "o", shown: "o", does: "Show the description and comments", group: "Reviewing" },
  { key: "h", shown: "h", does: "History of this file, to compare a past version", group: "Reviewing" },
  { key: "P", shown: "⇧P", does: "Finish this pass — the next push is read against it", group: "Reviewing" },
  { key: "w", shown: "w", does: "Only what is new since your last finished pass", group: "Reviewing" },

  { key: "1", shown: "1", does: "Diff beside the file", group: "Views" },
  { key: "2", shown: "2", does: "Diff only", group: "Views" },
  { key: "3", shown: "3", does: "Whole file", group: "Views" },
  { key: "f", shown: "f", does: "Full screen", group: "Views" },
  { key: "?", shown: "?", does: "This help", group: "Views" },
  { key: "Escape", shown: "Esc", does: "Close whatever is open", group: "Views" },
];

export const GROUPS = ["Moving", "Reviewing", "Views"] as const;

/**
 * A single letter must never be stolen from a field someone is typing in —
 * the pull request box, a comment, the review summary.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
