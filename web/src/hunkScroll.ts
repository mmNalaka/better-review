/**
 * Stepping between hunks with the keyboard.
 *
 * Which hunk you are "on" is a question about what is on screen, not about
 * React state — the diff pane is a scrolling list and the answer changes as it
 * moves. So this reads the layout rather than tracking an index that would
 * drift the moment anyone touched the scrollbar.
 */

/** A hunk counts as ahead once it starts more than this far below the top. */
const EDGE = 8;

export function stepHunk(direction: 1 | -1): boolean {
  const pane = document.querySelector(".diffpane");
  if (!pane) return false;

  const blocks = [...pane.querySelectorAll<HTMLElement>(".hunkblock")];
  if (blocks.length === 0) return false;

  const top = pane.getBoundingClientRect().top;
  const offsets = blocks.map((block) => block.getBoundingClientRect().top - top);

  const ahead = offsets.findIndex((offset) => offset > EDGE);
  // Backwards: the last hunk that starts above the top edge.
  let behind = -1;
  for (let i = 0; i < offsets.length; i++) if (offsets[i]! < -EDGE) behind = i;

  const next = direction === 1 ? blocks[ahead] : blocks[behind];
  if (!next) return false;

  next.scrollIntoView({ block: "start", behavior: "smooth" });
  return true;
}
