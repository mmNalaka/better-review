import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "better-review:explorer-width";
export const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 200;
/** Leave room for the code pane however far the divider is dragged. */
const maxWidth = () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.7));

const clamp = (value: number) => Math.min(Math.max(value, MIN_WIDTH), maxWidth());

function stored(): number {
  const raw = Number(localStorage.getItem(KEY));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : DEFAULT_WIDTH;
}

/**
 * Width of the explorer, dragged by the divider and remembered across reloads.
 * Paths are long — `services/iam-api/src/repositories/platform-framework/…` —
 * and a fixed sidebar could never show them.
 */
export function useExplorerWidth() {
  const [width, setWidth] = useState<number>(() => {
    try {
      return stored();
    } catch {
      return DEFAULT_WIDTH; // private mode, or storage disabled
    }
  });
  const dragging = useRef(false);

  const apply = useCallback((next: number) => {
    const clamped = clamp(next);
    setWidth(clamped);
    try {
      localStorage.setItem(KEY, String(clamped));
    } catch {
      // remembering is a nicety, not a requirement
    }
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      apply(event.clientX);
    };
    const stop = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.classList.remove("resizing");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [apply]);

  const startDrag = useCallback(() => {
    dragging.current = true;
    document.body.classList.add("resizing");
  }, []);

  /** Keyboard equivalent, so the divider is not mouse-only. */
  const nudge = useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 48 : 16;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        apply(width - step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        apply(width + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        apply(DEFAULT_WIDTH);
      }
    },
    [apply, width],
  );

  const reset = useCallback(() => apply(DEFAULT_WIDTH), [apply]);

  return { width, startDrag, nudge, reset };
}
