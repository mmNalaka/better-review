import { useEffect, useRef } from "react";

import { isTyping } from "./shortcuts";

/**
 * One listener for every shortcut.
 *
 * Handlers are looked up by `event.key`, so the map's keys are the same
 * strings the help panel prints. A key with no handler simply does nothing,
 * which is what should happen while a pull request is still loading.
 */

export type KeyHandlers = Readonly<Record<string, (() => void) | undefined>>;

export function useKeys(handlers: KeyHandlers): void {
  // Bound once, reading the current handlers from a ref: re-binding on every
  // render would swap the listener out on each keystroke.
  const current = useRef(handlers);
  current.current = handlers;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Shortcuts are bare keys. Anything with a modifier belongs to the
      // browser or the OS — ⌘F is find, not full screen.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      const handler = current.current[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
