import type { Fullscreen } from "./useFullscreen";

/** Lives in the top bar, not the mode bar: it works before a PR is open. */

interface FullscreenButtonProps {
  readonly fullscreen: Fullscreen;
}

export function FullscreenButton({ fullscreen }: FullscreenButtonProps) {
  if (!fullscreen.supported) return null;

  return (
    <span className="fullscreen">
      <button
        type="button"
        aria-pressed={fullscreen.active}
        onClick={fullscreen.toggle}
        title={
          fullscreen.active
            ? "Leave full screen — f, or Escape"
            : "Full screen — f"
        }
      >
        <span className="fullscreen-glyph" aria-hidden="true">
          {fullscreen.active ? "⤡" : "⤢"}
        </span>
        {fullscreen.active ? "Exit" : "Full screen"}
      </button>
      {fullscreen.error && <span className="fullscreen-said">{fullscreen.error}</span>}
    </span>
  );
}
