import { useCallback, useEffect, useState } from "react";

/**
 * Full screen, for the same reason the explorer is resizable: the review is the
 * code, and browser chrome is three wasted rows of it. Escape leaves — the
 * browser handles that itself — so the only thing to own here is entering.
 *
 * The `f` shortcut lives with all the others in shortcuts.ts; this hook only
 * knows how to toggle.
 */

/** Safari (including iPadOS) still ships only the prefixed API. */
type PrefixedDocument = Document & {
  readonly webkitFullscreenEnabled?: boolean;
  readonly webkitFullscreenElement?: Element | null;
  readonly webkitExitFullscreen?: () => Promise<void> | void;
};

type PrefixedElement = Element & {
  readonly webkitRequestFullscreen?: () => Promise<void> | void;
};

const prefixed = (): PrefixedDocument => document as PrefixedDocument;

const current = (): Element | null =>
  document.fullscreenElement ?? prefixed().webkitFullscreenElement ?? null;

/**
 * iPhone Safari reports no support at all, and an embedded frame reports none
 * unless `allowfullscreen` is set. Either way the control has nothing to do, so
 * it hides rather than failing on click.
 */
const isSupported = (): boolean =>
  Boolean(document.fullscreenEnabled ?? prefixed().webkitFullscreenEnabled ?? false);

const message = (cause: unknown): string =>
  cause instanceof Error && cause.message
    ? cause.message
    : "Full screen was refused by the browser.";

export interface Fullscreen {
  readonly active: boolean;
  readonly supported: boolean;
  /** Set when the browser refused the request, cleared on the next attempt. */
  readonly error: string | null;
  readonly toggle: () => void;
}

export function useFullscreen(): Fullscreen {
  // The document may already be full screen on mount — a reload keeps it.
  const [active, setActive] = useState(() => current() !== null);
  const [supported] = useState(isSupported);
  const [error, setError] = useState<string | null>(null);

  // The browser also leaves full screen on its own (Escape, or the OS), so the
  // event is the source of truth, never the click.
  useEffect(() => {
    const sync = () => setActive(current() !== null);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    setError(null);
    void (async () => {
      try {
        if (current() !== null) {
          const exit = prefixed().webkitExitFullscreen;
          await (document.exitFullscreen?.() ?? exit?.call(document));
          return;
        }
        // The whole document, not one pane: fixed overlays such as the commits
        // panel are painted outside .app and would be cropped away otherwise.
        const root: PrefixedElement = document.documentElement;
        await (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
      } catch (cause) {
        setError(message(cause));
      }
    })();
  }, []);

  return { active, supported, error, toggle };
}

